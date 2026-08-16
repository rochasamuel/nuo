import { ArraySchema, Schema, type } from "@colyseus/schema";
import {
  DEFAULT_MAX_PLAYERS,
  type Card,
  type GamePhase,
  type HouseRules,
} from "@uno/shared";

/**
 * Everything in here is public: it is broadcast to every client in the room.
 * Hands are deliberately absent — they go to their owner only, as a `hand` message.
 */

export class CardState extends Schema {
  @type("string") id = "";
  @type("string") color = "";
  @type("string") kind = "";
  /** 0-9 on number cards, -1 on the others. */
  @type("int8") value = -1;

  static from(card: Card): CardState {
    const state = new CardState();
    state.id = card.id;
    state.color = card.color;
    state.kind = card.type;
    state.value = card.value ?? -1;
    return state;
  }
}

/** As regras opcionais em vigor. Um campo por regra, e o nome é o de `HouseRules`. */
export class RulesState extends Schema implements HouseRules {
  @type("boolean") stacking = false;
  @type("boolean") drawUntilPlayable = false;
}

export class PlayerState extends Schema {
  @type("string") id = "";
  @type("string") name = "";
  @type("uint8") cardCount = 0;
  @type("boolean") connected = true;
  @type("boolean") calledUno = false;
}

export class UnoRoomState extends Schema {
  @type("string") roomName = "";
  @type("string") hostId = "";
  @type("string") phase: GamePhase = "lobby";
  @type("uint8") maxPlayers = DEFAULT_MAX_PLAYERS;
  @type(RulesState) rules = new RulesState();
  @type([PlayerState]) players = new ArraySchema<PlayerState>();

  @type("string") currentPlayerId = "";
  /**
   * O sorteado: o nome em que a roleta vai parar. Vale enquanto ela gira e é
   * apagado quando as cartas saem — vazio quer dizer que não há sorteio em
   * curso, e é só isso que a mesa precisa saber para mostrar ou esconder a
   * roleta. Quem começou a partida, depois dela, quem conta é o log.
   */
  @type("string") starterId = "";
  @type("string") currentColor = "";
  @type("int8") direction = 1;
  @type("uint8") pendingDraw = 0;
  @type("uint16") deckCount = 0;
  /** Size of the whole pile; `discard` only carries the few cards that are still visible. */
  @type("uint16") discardCount = 0;
  @type([CardState]) discard = new ArraySchema<CardState>();
  @type("string") winnerId = "";
  @type("string") vulnerablePlayerId = "";
  /** A carência passou: os outros já podem pegar quem está exposto. */
  @type("boolean") catchOpen = false;
  /** The current player drew a playable card: they may play that one card or pass. */
  @type("boolean") mustPlayDrawn = false;
  @type(["string"]) log = new ArraySchema<string>();
}
