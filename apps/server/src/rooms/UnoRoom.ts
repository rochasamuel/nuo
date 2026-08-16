import { Room, type Client, type CloseCode } from "colyseus";
import {
  DEFAULT_MAX_PLAYERS,
  LOBBY_RECONNECT_TIMEOUT,
  MAX_PLAYERS,
  MIN_PLAYERS,
  RECONNECT_TIMEOUT,
  RULES,
  STARTER_SPIN,
  UNO_GRACE,
  type CatchMessage,
  type CreateRoomOptions,
  type ErrorMessage,
  type FxMessage,
  type HandMessage,
  type JoinRoomOptions,
  type PlayMessage,
} from "@uno/shared";
import { GameError, UnoGame } from "../game/UnoGame.js";
import { CardState, PlayerState, UnoRoomState } from "./UnoState.js";

/** Cards of the discard pile the clients keep, so the table can render a messy stack. */
const VISIBLE_DISCARD = 8;

const ROOM_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const ROOM_CODE_LENGTH = 5;
const LOBBY_CHANNEL = "$unolobby";

export class UnoRoom extends Room<{ state: UnoRoomState }> {
  state = new UnoRoomState();

  private game = new UnoGame();
  private connected = new Set<string>();
  /** Reavisa os clientes quando a carência do "Pegar" termina. */
  private graceTimer?: { clear: () => void };
  /** A volta da roleta em curso. Enquanto existir, a mesa está sorteando. */
  private starterTimer?: { clear: () => void };

  messages = {
    start: (client: Client) => this.act(client, () => this.draft(client)),

    play: (client: Client, message: PlayMessage) => this.act(client, () =>
      this.game.playCard(client.sessionId, message?.cardId, message?.color),
    ),

    draw: (client: Client) => this.act(client, () =>
      this.game.drawCard(client.sessionId),
    ),

    pass: (client: Client) => this.act(client, () =>
      this.game.pass(client.sessionId),
    ),

    uno: (client: Client) => this.act(client, () =>
      this.game.callUno(client.sessionId),
    ),

    catch: (client: Client, message: CatchMessage) => this.act(client, () =>
      this.game.catchUno(client.sessionId, message?.targetId),
    ),

    restart: (client: Client) => this.act(client, () => {
      this.requireHost(client);
      if (this.game.phase !== "finished") {
        throw new GameError("A partida ainda está em andamento.");
      }
      // A revanche é uma partida nova, e uma partida nova se sorteia: o vencedor
      // não herda a saída.
      this.draft(client);
    }),
  };

  async onCreate(options: CreateRoomOptions) {
    this.roomId = await this.generateRoomId();
    this.state.roomName = sanitize(options?.roomName, "Sala UNO", 40);
    this.state.maxPlayers = clamp(
      Number(options?.maxPlayers) || DEFAULT_MAX_PLAYERS,
      MIN_PLAYERS,
      MAX_PLAYERS,
    );
    this.maxClients = this.state.maxPlayers;
    // O combinado da mesa entra aqui e não muda mais: `RULES` é a lista, e o
    // cliente só pode ligar o que está nela.
    for (const { key } of RULES) {
      this.game.rules[key] = this.state.rules[key] = options?.rules?.[key] === true;
    }
  }

  onJoin(client: Client, options: JoinRoomOptions) {
    this.game.addPlayer(client.sessionId, sanitize(options?.playerName, "Jogador", 16));
    this.connected.add(client.sessionId);
    if (!this.state.hostId) this.state.hostId = client.sessionId;
    this.sync();
  }

  onDrop(client: Client) {
    this.connected.delete(client.sessionId);
    this.sync();
    // Guardar o lugar é também o que mantém a sala viva: o Colyseus só descarta
    // uma sala sem clientes quando não há mais nenhuma reserva pendente.
    this.allowReconnection(
      client,
      this.game.phase === "playing" ? RECONNECT_TIMEOUT : LOBBY_RECONNECT_TIMEOUT,
    );
  }

  onReconnect(client: Client) {
    this.connected.add(client.sessionId);
    this.sync();
  }

  onLeave(client: Client, _code: CloseCode) {
    this.connected.delete(client.sessionId);
    this.game.removePlayer(client.sessionId);
    if (this.state.hostId === client.sessionId) {
      this.state.hostId = this.game.players[0]?.id ?? "";
    }
    // A sala continua fechada enquanto a roleta gira: quem entrasse no meio da
    // volta receberia cartas de um sorteio que já passou na tela dele.
    if (this.game.phase !== "playing" && !this.starterTimer) this.unlock();
    this.sync();
  }

  onDispose() {
    return this.presence.srem(LOBBY_CHANNEL, this.roomId);
  }

  /* --------------------------------------------------------------- private */

  /** Runs a game action, reporting rejections to the caller instead of crashing the room. */
  private act(client: Client, action: () => void) {
    try {
      action();
    } catch (error) {
      if (error instanceof GameError) {
        client.send("error", { message: error.message } satisfies ErrorMessage);
        return;
      }
      throw error;
    }
    this.sync();
  }

  /**
   * Sorteia quem começa e agenda a partida para quando a roleta parar.
   *
   * O sorteado é publicado ANTES de as cartas saírem: é ele que a roleta gira
   * até encontrar, e é o servidor quem conta o tempo da volta. Fosse cada
   * cliente a sortear a sua, cada mesa veria um vencedor diferente; fosse cada
   * cliente a contar o tempo, o reparto chegaria em cima de uma roleta ainda
   * girando na tela de quem tem a aba mais lenta.
   */
  private draft(client: Client) {
    this.requireHost(client);
    if (this.starterTimer) throw new GameError("O sorteio já está rolando.");
    this.state.starterId = this.game.draftStarter();
    this.lock();
    this.starterTimer = this.clock.setTimeout(() => this.beginMatch(), STARTER_SPIN);
  }

  /** A roleta parou: as cartas saem, e o sorteio deixa de estar em curso. */
  private beginMatch() {
    this.starterTimer = undefined;
    const starter = this.state.starterId;
    this.state.starterId = "";
    try {
      this.game.start(starter);
    } catch {
      // A mesa desmanchou enquanto a roleta girava e não há mais partida a
      // começar. O lobby reabre, e o host sorteia de novo quando houver gente.
      this.unlock();
    }
    this.sync();
  }

  private requireHost(client: Client) {
    if (client.sessionId !== this.state.hostId) {
      throw new GameError("Apenas o host pode fazer isso.");
    }
  }

  /** Mirrors the public half of the game into the synchronized state, then hands out the private half. */
  private sync() {
    const { game, state } = this;

    state.phase = game.phase;
    state.currentPlayerId = game.phase === "playing" ? (game.currentPlayer?.id ?? "") : "";
    state.currentColor = game.currentColor;
    state.direction = game.direction;
    state.pendingDraw = game.pendingDraw;
    state.deckCount = game.deck.length;
    state.winnerId = game.winnerId;
    state.vulnerablePlayerId = game.vulnerableId;
    state.catchOpen = game.catchOpen;
    state.mustPlayDrawn = game.drawnCardId !== null;

    this.syncPlayers();

    if (state.discardCount !== game.discard.length) {
      state.discardCount = game.discard.length;
      state.discard.splice(0);
      for (const card of game.discard.slice(-VISIBLE_DISCARD)) {
        state.discard.push(CardState.from(card));
      }
    }

    if (state.log.length !== game.log.length || state.log.at(-1) !== game.log.at(-1)) {
      state.log.splice(0);
      state.log.push(...game.log);
    }

    this.armCatchWindow();
    this.sendFx();
    this.sendHands();
  }

  /**
   * Antes da mão, e antes do patch de estado: o evento é o aviso de que uma
   * carta está a caminho, e o cliente precisa dele para segurar a carta em vez
   * de mostrá-la no destino antes de o voo sair. A mão vai logo atrás na mesma
   * volta; o patch de estado sai sozinho, no intervalo do `patchRate`.
   */
  private sendFx() {
    const events = this.game.takeFx();
    if (events.length > 0) this.broadcast("fx", events satisfies FxMessage);
  }

  /**
   * `catchOpen` vira `true` sozinho com a passagem do tempo, e nada dispararia
   * um novo patch para os clientes. Este timer existe só para reavisar a mesa
   * no instante em que a janela abre.
   */
  private armCatchWindow() {
    this.graceTimer?.clear();
    this.graceTimer = undefined;
    if (!this.game.vulnerableId || this.game.catchOpen) return;
    this.graceTimer = this.clock.setTimeout(() => this.sync(), UNO_GRACE);
  }

  private syncPlayers() {
    const rosterChanged =
      this.state.players.length !== this.game.players.length ||
      this.game.players.some((player, i) => this.state.players[i]?.id !== player.id);

    if (rosterChanged) {
      this.state.players.splice(0);
      for (const player of this.game.players) {
        const entry = new PlayerState();
        entry.id = player.id;
        entry.name = player.name;
        this.state.players.push(entry);
      }
    }

    this.game.players.forEach((player, i) => {
      const entry = this.state.players[i];
      entry.cardCount = player.hand.length;
      entry.calledUno = player.calledUno;
      entry.connected = this.connected.has(player.id);
    });
  }

  private sendHands() {
    for (const client of this.clients) {
      const player = this.game.players.find((p) => p.id === client.sessionId);
      if (!player) continue;
      client.send("hand", {
        cards: player.hand,
        playableIds: this.game.playableCards(player.id).map((c) => c.id),
      } satisfies HandMessage);
    }
  }

  /** Short, shareable room codes instead of the default random ids. */
  private async generateRoomId(): Promise<string> {
    const taken = await this.presence.smembers(LOBBY_CHANNEL);
    let id = "";
    do {
      id = Array.from(
        { length: ROOM_CODE_LENGTH },
        () => ROOM_CODE_ALPHABET[Math.floor(Math.random() * ROOM_CODE_ALPHABET.length)],
      ).join("");
    } while (taken.includes(id));
    await this.presence.sadd(LOBBY_CHANNEL, id);
    return id;
  }
}

function sanitize(value: unknown, fallback: string, maxLength: number): string {
  const text = typeof value === "string" ? value.trim().slice(0, maxLength) : "";
  return text || fallback;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
