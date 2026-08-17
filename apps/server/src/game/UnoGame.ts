import {
  COLOR_NAME,
  DEFAULT_RULES,
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
  type HouseRules,
  type PlayColor,
} from "@uno/shared";
import { createDeck, shuffle } from "./deck.js";
import { canPlay, canStack } from "./rules.js";

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
  /** O combinado da mesa. A sala escreve uma vez, ao criar; a partida só lê. */
  rules: HouseRules = { ...DEFAULT_RULES };
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
  /**
   * Quem ainda deve o tapa no 9 que está no topo do descarte. Enquanto tiver
   * alguém aqui a mesa está congelada: é a única situação do jogo em que todo
   * mundo age ao mesmo tempo, e deixar uma jogada passar no meio trocaria a
   * carta debaixo da mão de quem ainda está batendo.
   */
  slapPending: string[] = [];
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

    // Quem saiu não deve mais o tapa — e a saída pode ser justamente o que
    // decide a corrida, então ela fecha aqui, e não na próxima batida.
    const owed = this.slapPending.indexOf(id);
    if (owed !== -1) {
      this.slapPending.splice(owed, 1);
      this.closeSlapIfDecided();
    }
  }

  /**
   * Quem começa, tirado no sorteio. Fica separado do `start` porque a mesa
   * precisa do nome ANTES de a partida existir: é ele que a roleta gira até
   * parar, e só quando ela para é que as cartas são repartidas.
   */
  draftStarter(): string {
    this.requireStartable();
    return this.players[Math.floor(this.random() * this.players.length)].id;
  }

  /**
   * `starterId` é o sorteado. Sem ele — ou se ele saiu enquanto a roleta girava
   * — começa o primeiro assento, que é como a partida sempre começou.
   */
  start(starterId?: string) {
    this.requireStartable();

    const drafted = this.players.findIndex((p) => p.id === starterId);
    this.deck = shuffle(createDeck(), this.random);
    this.discard = [];
    this.direction = 1;
    this.currentIndex = drafted === -1 ? 0 : drafted;
    this.pendingDraw = 0;
    this.drawnCardId = null;
    this.vulnerableId = "";
    this.slapPending = [];
    this.winnerId = "";
    this.phase = "playing";
    this.log = [];
    this.fx = [];

    for (const player of this.players) {
      player.hand = this.deck.splice(-INITIAL_HAND_SIZE);
      player.calledUno = false;
      this.fx.push({ k: "deal", to: player.id, n: player.hand.length });
    }

    // Antes da carta inicial: o log conta a partida na ordem em que ela
    // aconteceu, e o sorteio veio primeiro.
    this.pushLog(`Sorteio: ${this.currentPlayer!.name} começa a partida.`);

    this.discard.push(this.drawStartingCard());
    this.fx.push({ k: "flip" });
    this.currentColor = this.topCard!.color as PlayColor;
    this.pushLog(`A partida começou com ${cardLabel(this.topCard!)}.`);
    this.applyStartingCard();
  }

  playCard(playerId: string, cardId: string, chosenColor?: PlayColor) {
    const player = this.requireTurn(playerId);
    if (this.drawnCardId !== null && this.drawnCardId !== cardId) {
      throw new GameError("Você já comprou: jogue a carta comprada ou passe.");
    }

    const index = player.hand.findIndex((c) => c.id === cardId);
    if (index === -1) throw new GameError("Você não tem essa carta.");

    const card = player.hand[index];
    if (!this.isLegal(card)) {
      throw new GameError(
        this.pendingDraw > 0
          ? `Você precisa comprar ${this.pendingDraw} cartas.`
          : "Essa carta não combina com o descarte.",
      );
    }
    if (isWild(card) && !PLAY_COLORS.includes(chosenColor as PlayColor)) {
      throw new GameError("Escolha uma cor válida.");
    }

    this.vulnerableId = "";
    player.hand.splice(index, 1);
    this.discard.push(card);
    this.fx.push({ k: "play", by: player.id });
    this.currentColor = isWild(card) ? chosenColor! : (card.color as PlayColor);
    // A cor do coringa não está na carta: sem dizê-la aqui, o log conta que
    // alguém jogou um coringa e não conta o que a mesa virou.
    const chose = isWild(card) ? ` e escolheu ${COLOR_NAME[this.currentColor]}` : "";
    this.pushLog(`${player.name} jogou ${cardLabel(card)}${chose}.`);

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
    // O tapa segura o efeito da carta: a vez só anda quando a corrida acabar.
    if (this.opensSlap(card)) return;
    this.applyEffect(card);
  }

  /**
   * Bater no 9. Sai da lista de quem deve — e quando sobra um só, a corrida
   * acabou: não há o que esperar da última mão, porque ela já perdeu.
   */
  slap(playerId: string) {
    if (this.slapPending.length === 0) throw new GameError("Não há tapa em jogo.");
    const index = this.slapPending.indexOf(playerId);
    if (index === -1) throw new GameError("Você já bateu.");

    this.slapPending.splice(index, 1);
    this.fx.push({ k: "slap", by: playerId });
    this.closeSlapIfDecided();
  }

  /**
   * A rede de segurança do tapa, puxada de fora pela sala. Aqui não há mais
   * corrida a decidir: quem não bateu a tempo paga, sejam quantos forem.
   */
  timeoutSlap() {
    if (this.slapPending.length === 0) return;
    this.punishSlappers(this.slapPending.splice(0), "late");
    this.resumeAfterSlap();
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
    if (player.hand.some((c) => this.isLegal(c))) {
      throw new GameError("Você tem carta jogável: só compre quando não puder jogar.");
    }

    // Uma carta, ou até vir uma que sirva. A busca sempre termina: o monte é
    // finito e o descarte só se recicla enquanto tiver o que reciclar.
    const taken: Card[] = [];
    for (;;) {
      const [card] = this.take(1);
      if (!card) break;
      taken.push(card);
      player.hand.push(card);
      if (this.isLegal(card)) {
        this.drawnCardId = card.id;
        break;
      }
      if (!this.rules.drawUntilPlayable) break;
    }

    if (taken.length === 0) {
      this.pushLog("Não há cartas para comprar.");
      this.endTurn();
      return;
    }

    this.fx.push({ k: "draw", to: player.id, n: taken.length });
    player.calledUno = false;
    this.pushLog(
      taken.length === 1
        ? `${player.name} comprou uma carta.`
        : `${player.name} comprou ${taken.length} até achar uma jogável.`,
    );

    if (this.drawnCardId === null) this.endTurn();
  }

  /** Give up the turn after drawing an unplayed card. */
  pass(playerId: string) {
    const player = this.requireTurn(playerId);
    if (this.drawnCardId === null) {
      throw new GameError("Você só pode passar depois de comprar.");
    }
    // Comprar até achar é uma busca com destino: a mesa pagou cartas até
    // aparecer uma que serve, e passar aqui devolveria a escolha que a regra
    // tirou — as compras do caminho não teriam servido para nada.
    if (this.rules.drawUntilPlayable) {
      throw new GameError("Você comprou até achar: é obrigatório jogar a carta.");
    }
    this.pushLog(`${player.name} passou a vez.`);
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
    // Mesa congelada pelo tapa: nada é jogável, nem para quem tem a vez. Sem
    // isto o leque continua aceso convidando para uma jogada que será recusada.
    if (this.slapPending.length > 0) return [];
    if (this.currentPlayer?.id !== playerId) return [];
    if (this.drawnCardId !== null) {
      return player.hand.filter((c) => c.id === this.drawnCardId);
    }
    return player.hand.filter((c) => this.isLegal(c));
  }

  /* --------------------------------------------------------------- private */

  /**
   * Com compra pendente a mesa fecha: ou se empilha, ou se compra. Fora dela
   * vale a regra normal do descarte — e numa mesa que não empilha nada é legal
   * enquanto a compra estiver de pé, que é como o jogo sempre funcionou.
   */
  private isLegal(card: Card): boolean {
    if (this.pendingDraw > 0) {
      return this.rules.stacking && canStack(card, this.topCard!);
    }
    return canPlay(card, this.topCard!, this.currentColor);
  }

  /** As duas condições para haver partida. O sorteio as cobra tanto quanto o começo. */
  private requireStartable() {
    if (this.phase === "playing") throw new GameError("A partida já começou.");
    if (this.players.length < MIN_PLAYERS) {
      throw new GameError(`São necessários pelo menos ${MIN_PLAYERS} jogadores.`);
    }
  }

  private requireTurn(playerId: string): GamePlayer {
    if (this.phase !== "playing") throw new GameError("A partida não está em andamento.");
    // A mesa está congelada pelo tapa. Deixar a vez andar aqui trocaria a carta
    // debaixo da mão de quem ainda está batendo.
    if (this.slapPending.length > 0) throw new GameError("Bata no 9 primeiro.");
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

  /* ------------------------------------------------------------ tapa no 9 */

  /**
   * Abre o tapa, se a carta pedir. Todo mundo entra na lista, inclusive quem
   * baixou: a regra é essa, e é o que faz a corrida valer para a mesa toda.
   */
  private opensSlap(card: Card): boolean {
    if (!this.rules.slapNine) return false;
    if (card.type !== "number" || card.value !== 9) return false;
    this.slapPending = this.players.map((p) => p.id);
    this.pushLog("Tapa no 9! Todo mundo bate na carta.");
    // Com dois na mesa a corrida ainda existe — o primeiro a bater ganha —, mas
    // uma mesa de um jogador só não tem em quem perder.
    return !this.closeSlapIfDecided();
  }

  /** Sobrou um? Então ele é o mais lento, e a rodada acaba sem esperá-lo. */
  private closeSlapIfDecided(): boolean {
    if (this.slapPending.length > 1) return false;
    this.punishSlappers(this.slapPending.splice(0), "slowest");
    this.resumeAfterSlap();
    return true;
  }

  /**
   * Uma carta para cada mão que ficou devendo.
   *
   * `why` só muda o que o log conta, e conta duas coisas diferentes: perder a
   * corrida por ser o mais lento é o jogo funcionando, e não bater dentro do
   * prazo é a mesa ter travado. Escrever "bateu por último" para três pessoas
   * de uma vez seria a segunda situação contada como se fosse a primeira.
   */
  private punishSlappers(ids: string[], why: "slowest" | "late") {
    for (const id of ids) {
      const player = this.players.find((p) => p.id === id);
      if (!player) continue;
      const taken = this.take(1);
      if (taken.length === 0) {
        this.pushLog(`${player.name} devia uma carta, mas não há o que comprar.`);
        continue;
      }
      player.hand.push(...taken);
      this.fx.push({ k: "draw", to: player.id, n: taken.length });
      // Comprar tira quem estava com uma carta só da linha de tiro, exatamente
      // como em qualquer outra compra.
      player.calledUno = false;
      if (this.vulnerableId === player.id) this.vulnerableId = "";
      this.pushLog(
        why === "slowest"
          ? `${player.name} bateu por último e comprou uma carta.`
          : `${player.name} não bateu a tempo e comprou uma carta.`,
      );
    }
  }

  /**
   * A mesa descongela: o 9 que ficou esperando finalmente faz efeito. Ele
   * continua sendo o topo do descarte porque nada pôde ser jogado no meio.
   */
  private resumeAfterSlap() {
    if (this.phase !== "playing") return;
    this.applyEffect(this.topCard!);
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
        this.stack(2);
        break;
      case "wild-draw-four":
        this.stack(4);
        break;
      default:
        this.advance();
        break;
    }
  }

  /**
   * Soma, e não atribui: numa mesa que não empilha o pendente é sempre zero
   * quando um +2/+4 é baixado, então a soma dá no mesmo. Empilhando, é o
   * acumulado crescendo até alguém não ter resposta.
   */
  private stack(amount: number) {
    this.pendingDraw += amount;
    if (this.pendingDraw > amount) {
      this.pushLog(`A compra acumulada subiu para ${this.pendingDraw}.`);
    }
    this.advance();
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
