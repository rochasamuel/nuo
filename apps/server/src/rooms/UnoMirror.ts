import type { ArraySchema } from "@colyseus/schema";
import type { GamePlayer, UnoGame } from "../game/UnoGame.js";
import { CardState, PlayerState, type UnoRoomState } from "./UnoState.js";

/** Cards of the discard pile the clients keep, so the table can render a messy stack. */
const VISIBLE_DISCARD = 8;

/** O que só a sala sabe de cada cadeira — o motor não conhece conexão. */
export type SeatStatus = {
  connected: (id: string) => boolean;
  /** Segundos de cadeira guardada que restam a quem caiu; `0` para os outros. */
  away: (player: GamePlayer) => number;
};

/**
 * O adaptador entre o motor e a rede: copia a metade pública do `UnoGame`
 * para o `UnoRoomState`, que é o que o Colyseus sincroniza.
 *
 * Ele existe à parte da sala porque é uma tarefa só, e uma tarefa de detalhe:
 * cada lista é escrita pela ponta que mudou, e não reescrita inteira, para que
 * uma jogada vire um patch de uma operação em vez de um da mesa toda.
 */
export class UnoMirror {
  /** Até que linha do log a mesa já foi espelhada. Ver `writeLog`. */
  private sentLogSeq = 0;

  write(state: UnoRoomState, game: UnoGame, seats: SeatStatus) {
    state.phase = game.phase;
    state.currentPlayerId = game.phase === "playing" ? (game.currentPlayer?.id ?? "") : "";
    state.currentColor = game.currentColor;
    state.direction = game.direction;
    state.pendingDraw = game.pendingDraw;
    state.deckCount = game.deck.length;
    state.winnerId = game.winnerId;
    writeList(state.vulnerablePlayerIds, game.vulnerable);
    state.catchOpen = game.catchOpen;
    state.mustPlayDrawn = game.drawnCardId !== null;
    state.swapChooserId = game.swapChooserId;

    writeList(state.slapPending, game.slapPending);

    this.writePlayers(state, game, seats);

    this.writeDiscard(state, game);
    this.writeLog(state, game);
  }

  writePlayers(state: UnoRoomState, game: UnoGame, seats: SeatStatus) {
    const rosterChanged =
      state.players.length !== game.players.length ||
      game.players.some((player, i) => state.players[i]?.id !== player.id);

    if (rosterChanged) {
      state.players.splice(0);
      for (const player of game.players) {
        const entry = new PlayerState();
        entry.id = player.id;
        entry.name = player.name;
        state.players.push(entry);
      }
    }

    game.players.forEach((player, i) => {
      const entry = state.players[i];
      entry.cardCount = player.hand.length;
      entry.calledUno = player.calledUno;
      entry.connected = seats.connected(player.id);
      entry.away = seats.away(player);
    });
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
  private writeDiscard(state: UnoRoomState, game: UnoGame) {
    const { discard } = game;
    const grew = discard.length - state.discardCount;
    /*
     * Mesma altura E mesmo topo é a mesma pilha. Só a altura não bastava:
     * uma revanche logo depois de um reembaralhar começa com uma carta, que é
     * exatamente quantas o reembaralhar deixou — e a mesa continuava mostrando
     * a carta da partida anterior, porque o número não tinha mexido.
     */
    if (grew === 0 && state.discard.at(-1)?.id === discard.at(-1)?.id) return;

    state.discardCount = discard.length;
    const visible = Math.min(VISIBLE_DISCARD, discard.length);

    if (grew > 0 && grew < visible) {
      for (const card of discard.slice(-grew)) {
        state.discard.push(CardState.from(card));
      }
      while (state.discard.length > visible) state.discard.shift();
      return;
    }

    state.discard.splice(0);
    for (const card of discard.slice(-visible)) {
      state.discard.push(CardState.from(card));
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
  private writeLog(state: UnoRoomState, game: UnoGame) {
    const { log, logSeq } = game;
    const fresh = logSeq - this.sentLogSeq;
    this.sentLogSeq = logSeq;

    // Pelo mesmo cuidado do descarte: o contador zerado de uma partida nova
    // pode cair exatamente onde o da anterior parou.
    const mirrored = state.log;
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
}

/**
 * Espelha uma lista de ids no estado sincronizado, e só quando ela de fato
 * mudou: reescrevê-la a cada `sync` mandaria um patch para a mesa inteira a
 * cada jogada, para dizer que nada mudou.
 */
function writeList(target: ArraySchema<string>, source: string[]) {
  if (target.length === source.length && source.every((id, i) => target[i] === id)) return;
  target.splice(0);
  target.push(...source);
}
