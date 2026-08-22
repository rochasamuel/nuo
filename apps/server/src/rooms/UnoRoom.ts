import { Room, type Client, type CloseCode } from "colyseus";
import {
  DEFAULT_MAX_PLAYERS,
  EMOTE_COOLDOWN,
  isEmote,
  LOBBY_RECONNECT_TIMEOUT,
  MAX_PLAYERS,
  MIN_PLAYERS,
  RECONNECT_TIMEOUT,
  RULES,
  SLAP_TIMEOUT,
  STARTER_SPIN,
  SWAP_TIMEOUT,
  UNO_GRACE,
  type CatchMessage,
  type CreateRoomOptions,
  type EmoteEvent,
  type EmoteMessage,
  type ErrorMessage,
  type FxMessage,
  type HandMessage,
  type JoinRoomOptions,
  type PlayMessage,
  type SwapMessage,
} from "@uno/shared";
import type { ArraySchema } from "@colyseus/schema";
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
  /** A rede de segurança do tapa no 9. Existe enquanto a corrida está aberta. */
  private slapTimer?: { clear: () => void };
  /** O mesmo para a troca no 7, enquanto a escolha não sai. */
  private swapTimer?: { clear: () => void };
  /** Quando cada jogador falou pela última vez, para o intervalo entre emojis. */
  private lastEmote = new Map<string, number>();
  /** A última mão que cada cliente recebeu, para não reenviar a mesma. */
  private sentHands = new Map<string, string>();
  /** Até que linha do log a mesa já foi espelhada. Ver `syncLog`. */
  private sentLogSeq = 0;

  messages = {
    start: (client: Client) => this.act(client, () => this.draft(client)),

    /*
     * "Me conta de novo onde estamos."
     *
     * O celular congela a aba quando a tela apaga ou quem joga sai para mandar
     * o convite, e a mesa volta do congelamento exibindo o quadro em que
     * parou. Enquanto o socket sobreviveu não há nada que reescreva esse
     * quadro: o Colyseus só manda o que MUDOU, e o que mudou já passou. Este
     * pedido é o cliente dizendo que não confia mais no que tem na tela.
     */
    resync: (client: Client) => this.resync(client),

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

    slap: (client: Client) => this.act(client, () =>
      this.game.slap(client.sessionId),
    ),

    swap: (client: Client, message: SwapMessage) => this.act(client, () =>
      this.game.chooseSwap(client.sessionId, message?.targetId),
    ),

    /**
     * A conversa da mesa. Não passa pelo `act` porque não é jogada: não muda
     * estado nenhum, não pode ser recusada com um aviso e não pede `sync` —
     * sai direto para todo mundo, inclusive de volta para quem falou, que é o
     * que confirma o envio na tela dele.
     *
     * Fora do intervalo o emoji é engolido em silêncio, e de propósito: quem
     * apertou rápido demais não cometeu erro nenhum, e um aviso vermelho por
     * isso seria mais barulhento que a mensagem que ele está impedindo.
     */
    emote: (client: Client, message: EmoteMessage) => {
      if (!isEmote(message?.emote)) return;
      const now = this.clock.currentTime;
      const last = this.lastEmote.get(client.sessionId) ?? -Infinity;
      if (now - last < EMOTE_COOLDOWN) return;
      this.lastEmote.set(client.sessionId, now);
      this.broadcast("emote", {
        by: client.sessionId,
        emote: message.emote,
      } satisfies EmoteEvent);
    },

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
    // Quem volta pode ser uma página nova, de leque vazio: o que ele já recebeu
    // não vale mais como aposta.
    this.sentHands.delete(client.sessionId);
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
    this.lastEmote.delete(client.sessionId);
    this.sentHands.delete(client.sessionId);
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
        /*
         * Uma recusa é a única pista que o servidor tem de que a tela de quem
         * tentou pode estar contando outra história — e, sem isto, era uma
         * pista jogada fora: a mesa dele seguia igual, o toque seguinte era
         * recusado igual, e uma divergência que devia durar um quadro durava
         * a partida inteira. Uma mesa travou assim, esperando uma jogadora que
         * via um botão apagado onde o servidor via a vez dela.
         *
         * O estado não mudou, então isto não corrige o servidor: corrige o
         * cliente, que é onde a divergência mora.
         */
        this.diagnose(client, error);
        this.resync(client);
        return;
      }
      throw error;
    }
    this.sync();
  }

  /**
   * Reescreve a mesa de UM cliente: o estado público inteiro e a mão dele.
   *
   * O estado inteiro, e não um remendo, porque o que se está consertando é
   * justamente não saber o que ele tem — o Colyseus manda diferenças, e uma
   * diferença sobre uma base errada continua errada.
   */
  private resync(client: Client) {
    /*
     * O mesmo caminho que o Colyseus percorre quando alguém entra ou reconecta,
     * só que sob demanda. É interno, daí a guarda: se uma versão futura mudar o
     * nome, a mão sozinha ainda conserta o leque — e é o leque que decide o que
     * a tela deixa tocar.
     */
    try {
      (this as unknown as { sendFullState(target: Client): void }).sendFullState(client);
    } catch {
      // segue só com a mão
    }
    this.sendHandTo(client, true);
  }

  /**
   * O rastro da divergência, para o servidor e não para a mesa.
   *
   * Recusar a ação de quem NÃO tem a vez é o jogo funcionando — chega o tempo
   * todo, de toque adiantado e de clique duplo. Recusar a ação de quem TEM a
   * vez é outra coisa: a tela dele ofereceu algo que o jogo não aceita, e é
   * essa a linha que vale a pena existir no log quando a mesa travar de novo.
   */
  private diagnose(client: Client, error: GameError) {
    if (this.game.currentPlayer?.id !== client.sessionId) return;
    console.warn(
      `[uno ${this.roomId}] recusa na vez de ${client.sessionId}: ${error.message}`,
      {
        phase: this.game.phase,
        pendingDraw: this.game.pendingDraw,
        drawnCardId: this.game.drawnCardId,
        playable: this.game.playableCards(client.sessionId).map((c) => c.id),
        hand: this.game.players.find((p) => p.id === client.sessionId)?.hand.length,
        slapPending: this.game.slapPending.length,
        swapChooserId: this.game.swapChooserId,
        rules: this.game.rules,
      },
    );
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
    syncList(state.vulnerablePlayerIds, game.vulnerable);
    state.catchOpen = game.catchOpen;
    state.mustPlayDrawn = game.drawnCardId !== null;
    state.swapChooserId = game.swapChooserId;

    syncList(state.slapPending, game.slapPending);

    this.syncPlayers();

    this.syncDiscard();
    this.syncLog();

    this.armCatchWindow();
    this.armSlapWindow();
    this.armSwapWindow();
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
    if (this.game.vulnerable.length === 0 || this.game.catchOpen) return;
    this.graceTimer = this.clock.setTimeout(() => this.sync(), UNO_GRACE);
  }

  /**
   * O prazo do tapa. Ele é da RODADA e não de cada batida: rearmá-lo a cada
   * tapa daria a quem está devendo cinco segundos novos toda vez que outro
   * batesse, e a mesa travada nunca destravaria.
   */
  private armSlapWindow() {
    if (this.game.slapPending.length === 0) {
      this.slapTimer?.clear();
      this.slapTimer = undefined;
      return;
    }
    if (this.slapTimer) return;
    this.slapTimer = this.clock.setTimeout(() => {
      this.slapTimer = undefined;
      this.game.timeoutSlap();
      this.sync();
    }, SLAP_TIMEOUT);
  }

  /**
   * O prazo da escolha da troca. É da JOGADA, e não da sessão de quem escolhe:
   * armado uma vez quando o 7 cai e desarmado quando a troca sai, de um jeito
   * ou de outro. Reconectar no meio não compra tempo novo.
   */
  private armSwapWindow() {
    if (this.game.swapChooserId === "") {
      this.swapTimer?.clear();
      this.swapTimer = undefined;
      return;
    }
    if (this.swapTimer) return;
    this.swapTimer = this.clock.setTimeout(() => {
      this.swapTimer = undefined;
      this.game.timeoutSwap();
      this.sync();
    }, SWAP_TIMEOUT);
  }

  /**
   * A ponta visível do descarte, escrita pelo fim.
   *
   * O caso comum é uma carta a mais no topo. Reescrever as oito para anunciar
   * uma custava oito objetos de esquema novos e um patch que apagava e
   * recriava a lista inteira — a cada jogada, para a mesa toda. Aqui entra o
   * que entrou e sai da frente o que saiu da janela.
   *
   * O que não cresce por uma carta não é jogada: é o reembaralhar, ou uma
   * partida nova. Aí não há trecho comum a aproveitar e a lista se reescreve,
   * que é o que ela sempre fez.
   */
  private syncDiscard() {
    const { discard } = this.game;
    const grew = discard.length - this.state.discardCount;
    /*
     * Mesma altura E mesmo topo é a mesma pilha. Só a altura não bastava:
     * uma revanche logo depois de um reembaralhar começa com uma carta, que é
     * exatamente quantas o reembaralhar deixou — e a mesa continuava mostrando
     * a carta da partida anterior, porque o número não tinha mexido.
     */
    if (grew === 0 && this.state.discard.at(-1)?.id === discard.at(-1)?.id) return;

    this.state.discardCount = discard.length;
    const visible = Math.min(VISIBLE_DISCARD, discard.length);

    if (grew > 0 && grew < visible) {
      for (const card of discard.slice(-grew)) {
        this.state.discard.push(CardState.from(card));
      }
      while (this.state.discard.length > visible) this.state.discard.shift();
      return;
    }

    this.state.discard.splice(0);
    for (const card of discard.slice(-visible)) {
      this.state.discard.push(CardState.from(card));
    }
  }

  /**
   * O log, pelo mesmo motivo e do mesmo jeito: ele é uma janela que anda, e
   * anunciar uma linha nova reescrevendo as doze mandava doze operações no
   * patch para dizer uma. `logSeq` é o que diz quantas são novas — sem ele não
   * dava para saber, porque duas linhas podem ter o mesmo texto.
   *
   * Uma partida nova zera o contador, e aí a janela inteira é outra.
   */
  private syncLog() {
    const { log, logSeq } = this.game;
    const fresh = logSeq - this.sentLogSeq;
    this.sentLogSeq = logSeq;

    // Pelo mesmo cuidado do descarte: o contador zerado de uma partida nova
    // pode cair exatamente onde o da anterior parou.
    const mirrored = this.state.log;
    if (fresh === 0 && mirrored.length === log.length && mirrored.at(-1) === log.at(-1)) {
      return;
    }
    if (fresh > 0 && fresh < log.length) {
      const dropped = mirrored.length + fresh - log.length;
      for (let i = 0; i < dropped; i++) mirrored.shift();
      for (const message of log.slice(-fresh)) mirrored.push(message);
      return;
    }

    mirrored.splice(0);
    mirrored.push(...log);
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
    for (const client of this.clients) this.sendHandTo(client);
  }

  /**
   * A metade privada da mesa, para um cliente só. Quem não joga não tem mão.
   *
   * E só quando ela mudou. Toda ação da mesa passa por `sync`, e `sync` mandava
   * a mão inteira para TODO mundo: uma jogada de um deles reescrevia o leque
   * dos dez, com as cartas uma a uma na rede e um redesenho da mesa inteira do
   * outro lado — para dizer que nada nele mudou. Os ids bastam para saber:
   * carta é identidade, e duas mãos com os mesmos ids são a mesma mão.
   *
   * `force` é para quem não tem passado com que comparar — quem acabou de
   * chegar, ou quem pediu a mesa de novo depois de o socket sumir.
   */
  private sendHandTo(client: Client, force = false) {
    const player = this.game.players.find((p) => p.id === client.sessionId);
    if (!player) return;

    const playableIds = this.game.playableCards(player.id).map((c) => c.id);
    const signature = `${player.hand.map((c) => c.id).join()}|${playableIds.join()}`;
    if (!force && this.sentHands.get(client.sessionId) === signature) return;
    this.sentHands.set(client.sessionId, signature);

    client.send("hand", { cards: player.hand, playableIds } satisfies HandMessage);
  }

  /**
   * Short, shareable room codes instead of the default random ids.
   *
   * Pergunta por UM código de cada vez em vez de baixar a lista de todas as
   * salas abertas: a conferência é a mesma, e o que se deixa de trazer pela
   * rede é o servidor inteiro — a cada mesa criada, e justo quando ele está
   * cheio, que é quando a lista é maior.
   */
  private async generateRoomId(): Promise<string> {
    for (;;) {
      const id = Array.from(
        { length: ROOM_CODE_LENGTH },
        () => ROOM_CODE_ALPHABET[Math.floor(Math.random() * ROOM_CODE_ALPHABET.length)],
      ).join("");
      if (await this.presence.sismember(LOBBY_CHANNEL, id)) continue;
      await this.presence.sadd(LOBBY_CHANNEL, id);
      return id;
    }
  }
}

/**
 * Espelha uma lista de ids no estado sincronizado, e só quando ela de fato
 * mudou: reescrevê-la a cada `sync` mandaria um patch para a mesa inteira a
 * cada jogada, para dizer que nada mudou.
 */
function syncList(target: ArraySchema<string>, source: string[]) {
  if (target.length === source.length && source.every((id, i) => target[i] === id)) return;
  target.splice(0);
  target.push(...source);
}

function sanitize(value: unknown, fallback: string, maxLength: number): string {
  const text = typeof value === "string" ? value.trim().slice(0, maxLength) : "";
  return text || fallback;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
