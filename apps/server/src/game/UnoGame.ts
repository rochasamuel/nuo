import {
  INITIAL_HAND_SIZE,
  MIN_PLAYERS,
  PLAY_COLORS,
  UNO_GRACE,
  UNO_PENALTY,
  cardLabel,
  isWild,
  type Card,
  type FxEvent,
  type GamePhase,
  type PlayColor,
} from "@uno/shared";
import { createDeck, shuffle } from "./deck.js";
import { canPlay } from "./rules.js";

/** Rejected player action. The room turns these into a message for that client. */
export class GameError extends Error {}

export type GamePlayer = {
  id: string;
  name: string;
  hand: Card[];
  calledUno: boolean;
};

const LOG_SIZE = 12;

export class UnoGame {
  players: GamePlayer[] = [];
  deck: Card[] = [];
  discard: Card[] = [];
  phase: GamePhase = "lobby";
  direction: 1 | -1 = 1;
  currentIndex = 0;
  currentColor: PlayColor = "red";
  /** Cards the current player owes before they may act. Zero except right after a +2/+4. */
  pendingDraw = 0;
  /** Set when the current player drew a playable card: they may still play that one card, or pass. */
  drawnCardId: string | null = null;
  /** Player left holding one card who never said UNO. Anyone may catch them until the next action. */
  vulnerableId = "";
  /** Quando essa exposição começou, para a carência do `catchUno`. */
  vulnerableSince = 0;
  winnerId = "";
  log: string[] = [];
  /**
   * O que aconteceu desde a última leitura, para a mesa animar. Fila, e não
   * estado: quem lê, esvazia. O `log` conta a mesma história em português; esta
   * conta em coordenadas — de onde a carta sai e para onde vai.
   */
  private fx: FxEvent[] = [];

  constructor(
    private random: () => number = Math.random,
    private now: () => number = Date.now,
  ) {}

  /** Reads and empties the animation queue. The room calls this once per sync. */
  takeFx(): FxEvent[] {
    return this.fx.splice(0);
  }

  get currentPlayer(): GamePlayer | undefined {
    return this.players[this.currentIndex];
  }

  get topCard(): Card | undefined {
    return this.discard[this.discard.length - 1];
  }

  /**
   * A janela do `catchUno` só abre depois da carência. Antes dela, quem está
   * exposto tem o direito exclusivo de se salvar gritando UNO — é isso que
   * impede o adversário de vencer a corrida só por já estar com o dedo no lugar.
   */
  get catchOpen(): boolean {
    return this.vulnerableId !== "" && this.now() - this.vulnerableSince >= UNO_GRACE;
  }

  addPlayer(id: string, name: string) {
    if (this.phase !== "lobby") throw new GameError("A partida já começou.");
    if (this.players.some((p) => p.id === id)) return;
    this.players.push({ id, name, hand: [], calledUno: false });
    this.pushLog(`${name} entrou na sala.`);
  }

  removePlayer(id: string) {
    const index = this.players.findIndex((p) => p.id === id);
    if (index === -1) return;
    const [gone] = this.players.splice(index, 1);
    this.deck.unshift(...gone.hand);
    if (this.vulnerableId === id) this.vulnerableId = "";
    this.pushLog(`${gone.name} saiu.`);

    if (this.phase !== "playing") return;
    if (this.players.length < MIN_PLAYERS) {
      this.phase = "finished";
      this.winnerId = this.players[0]?.id ?? "";
      this.pushLog("Jogadores insuficientes: a partida terminou.");
      return;
    }
    const wasCurrent = index === this.currentIndex;
    if (index < this.currentIndex || (wasCurrent && this.direction === -1)) {
      this.currentIndex--;
    }
    if (this.currentIndex < 0) this.currentIndex = this.players.length - 1;
    this.currentIndex %= this.players.length;
    this.drawnCardId = null;
    if (wasCurrent) this.pendingDraw = 0;
  }

  start() {
    if (this.phase === "playing") throw new GameError("A partida já começou.");
    if (this.players.length < MIN_PLAYERS) {
      throw new GameError(`São necessários pelo menos ${MIN_PLAYERS} jogadores.`);
    }

    this.deck = shuffle(createDeck(), this.random);
    this.discard = [];
    this.direction = 1;
    this.currentIndex = 0;
    this.pendingDraw = 0;
    this.drawnCardId = null;
    this.vulnerableId = "";
    this.winnerId = "";
    this.phase = "playing";
    this.log = [];
    this.fx = [];

    for (const player of this.players) {
      player.hand = this.deck.splice(-INITIAL_HAND_SIZE);
      player.calledUno = false;
      this.fx.push({ k: "deal", to: player.id, n: player.hand.length });
    }

    this.discard.push(this.drawStartingCard());
    this.fx.push({ k: "flip" });
    this.currentColor = this.topCard!.color as PlayColor;
    this.pushLog(`A partida começou com ${cardLabel(this.topCard!)}.`);
    this.applyStartingCard();
  }

  playCard(playerId: string, cardId: string, chosenColor?: PlayColor) {
    const player = this.requireTurn(playerId);
    if (this.pendingDraw > 0) {
      throw new GameError(`Você precisa comprar ${this.pendingDraw} cartas.`);
    }
    if (this.drawnCardId !== null && this.drawnCardId !== cardId) {
      throw new GameError("Você já comprou: jogue a carta comprada ou passe.");
    }

    const index = player.hand.findIndex((c) => c.id === cardId);
    if (index === -1) throw new GameError("Você não tem essa carta.");

    const card = player.hand[index];
    if (!canPlay(card, this.topCard!, this.currentColor)) {
      throw new GameError("Essa carta não combina com o descarte.");
    }
    if (isWild(card) && !PLAY_COLORS.includes(chosenColor as PlayColor)) {
      throw new GameError("Escolha uma cor válida.");
    }

    this.vulnerableId = "";
    player.hand.splice(index, 1);
    this.discard.push(card);
    this.fx.push({ k: "play", by: player.id });
    this.currentColor = isWild(card) ? chosenColor! : (card.color as PlayColor);
    this.pushLog(`${player.name} jogou ${cardLabel(card)}.`);

    if (player.hand.length === 0) {
      this.phase = "finished";
      this.winnerId = player.id;
      this.pushLog(`${player.name} venceu a partida!`);
      return;
    }
    if (player.hand.length === 1 && !player.calledUno) {
      this.vulnerableId = player.id;
      this.vulnerableSince = this.now();
    }
    if (player.hand.length > 1) player.calledUno = false;

    this.drawnCardId = null;
    this.applyEffect(card);
  }

  drawCard(playerId: string) {
    const player = this.requireTurn(playerId);
    this.vulnerableId = "";

    if (this.pendingDraw > 0) {
      const taken = this.take(this.pendingDraw);
      player.hand.push(...taken);
      if (taken.length > 0) this.fx.push({ k: "draw", to: player.id, n: taken.length });
      player.calledUno = false;
      this.pushLog(`${player.name} comprou ${taken.length} e perdeu a vez.`);
      this.pendingDraw = 0;
      this.endTurn();
      return;
    }

    if (this.drawnCardId !== null) {
      throw new GameError("Você já comprou nesta rodada.");
    }
    // Comprar é o que se faz na falta de jogada, não uma alternativa a ela.
    if (player.hand.some((c) => canPlay(c, this.topCard!, this.currentColor))) {
      throw new GameError("Você tem carta jogável: só compre quando não puder jogar.");
    }

    const [card] = this.take(1);
    if (!card) {
      this.pushLog("Não há cartas para comprar.");
      this.endTurn();
      return;
    }

    player.hand.push(card);
    this.fx.push({ k: "draw", to: player.id, n: 1 });
    player.calledUno = false;
    this.pushLog(`${player.name} comprou uma carta.`);

    if (canPlay(card, this.topCard!, this.currentColor)) {
      this.drawnCardId = card.id;
    } else {
      this.endTurn();
    }
  }

  /** Give up the turn after drawing an unplayed card. */
  pass(playerId: string) {
    this.requireTurn(playerId);
    if (this.drawnCardId === null) {
      throw new GameError("Você só pode passar depois de comprar.");
    }
    this.endTurn();
  }

  /**
   * Só vale depois de baixar a penúltima carta, nunca antes. Gritar com duas na
   * mão daria imunidade de graça e a penalidade nunca chegaria a existir — a
   * corrida contra o `catchUno` é justamente o que faz a regra valer.
   */
  callUno(playerId: string) {
    if (this.phase !== "playing") throw new GameError("A partida não está em andamento.");
    const player = this.players.find((p) => p.id === playerId);
    if (!player) throw new GameError("Você não está nesta partida.");
    if (player.calledUno) throw new GameError("Você já gritou UNO.");
    if (player.hand.length !== 1) {
      throw new GameError("Grite UNO assim que ficar com uma carta.");
    }
    player.calledUno = true;
    if (this.vulnerableId === playerId) this.vulnerableId = "";
    this.pushLog(`${player.name} gritou UNO!`);
  }

  catchUno(accuserId: string, targetId: string) {
    if (this.phase !== "playing") throw new GameError("A partida não está em andamento.");
    if (accuserId === targetId) throw new GameError("Você não pode se pegar.");
    if (!this.players.some((p) => p.id === accuserId)) {
      throw new GameError("Você não está nesta partida.");
    }
    if (this.vulnerableId !== targetId) {
      throw new GameError("Não há ninguém para pegar.");
    }
    if (!this.catchOpen) {
      throw new GameError("Espere: ele ainda pode gritar UNO.");
    }
    const target = this.players.find((p) => p.id === targetId)!;
    const taken = this.take(UNO_PENALTY);
    target.hand.push(...taken);
    if (taken.length > 0) this.fx.push({ k: "draw", to: target.id, n: taken.length });
    target.calledUno = false;
    this.vulnerableId = "";
    this.pushLog(`${target.name} esqueceu o UNO e comprou ${UNO_PENALTY}.`);
  }

  /** What this player is allowed to play right now. The client renders it; it never decides it. */
  playableCards(playerId: string): Card[] {
    const player = this.players.find((p) => p.id === playerId);
    if (!player) return [];
    if (this.phase !== "playing") return [];
    if (this.currentPlayer?.id !== playerId) return [];
    if (this.pendingDraw > 0) return [];
    if (this.drawnCardId !== null) {
      return player.hand.filter((c) => c.id === this.drawnCardId);
    }
    return player.hand.filter((c) => canPlay(c, this.topCard!, this.currentColor));
  }

  /* --------------------------------------------------------------- private */

  private requireTurn(playerId: string): GamePlayer {
    if (this.phase !== "playing") throw new GameError("A partida não está em andamento.");
    const player = this.currentPlayer;
    if (!player || player.id !== playerId) throw new GameError("Não é o seu turno.");
    return player;
  }

  /** The opening card is never a wild: wilds go back under the deck and we flip again. */
  private drawStartingCard(): Card {
    for (;;) {
      const card = this.deck.pop()!;
      if (!isWild(card)) return card;
      this.deck.unshift(card);
    }
  }

  private applyStartingCard() {
    const card = this.topCard!;
    switch (card.type) {
      case "skip":
        this.pushLog("A primeira carta bloqueia o jogador inicial.");
        this.advance();
        break;
      case "reverse":
        this.direction = -1;
        this.pushLog("A primeira carta inverte a direção.");
        this.advance();
        break;
      case "draw-two":
        this.pendingDraw = 2;
        this.pushLog("O jogador inicial precisa comprar 2.");
        break;
      default:
        break;
    }
  }

  private applyEffect(card: Card) {
    switch (card.type) {
      case "skip":
        this.advance(2);
        break;
      case "reverse":
        // With two players a reverse behaves as a skip: the same player goes again.
        if (this.players.length === 2) {
          this.advance(2);
        } else {
          this.direction = this.direction === 1 ? -1 : 1;
          this.advance();
        }
        break;
      case "draw-two":
        this.pendingDraw = 2;
        this.advance();
        break;
      case "wild-draw-four":
        this.pendingDraw = 4;
        this.advance();
        break;
      default:
        this.advance();
        break;
    }
  }

  private endTurn() {
    this.drawnCardId = null;
    this.advance();
  }

  private advance(steps = 1) {
    const n = this.players.length;
    if (n === 0) return;
    this.currentIndex = (((this.currentIndex + this.direction * steps) % n) + n) % n;
  }

  private take(count: number): Card[] {
    const taken: Card[] = [];
    for (let i = 0; i < count; i++) {
      if (this.deck.length === 0) this.refill();
      const card = this.deck.pop();
      if (!card) break;
      taken.push(card);
    }
    return taken;
  }

  /** When the deck runs out the discard pile — minus the card in play — becomes the new deck. */
  private refill() {
    if (this.discard.length <= 1) return;
    const top = this.discard.pop()!;
    this.deck = shuffle(this.discard, this.random);
    this.discard = [top];
    this.fx.push({ k: "recycle" });
    this.pushLog("A compra acabou: o descarte foi reembaralhado.");
  }

  private pushLog(message: string) {
    this.log.push(message);
    if (this.log.length > LOG_SIZE) this.log.splice(0, this.log.length - LOG_SIZE);
  }
}
