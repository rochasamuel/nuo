export const PLAY_COLORS = ["red", "yellow", "green", "blue"] as const;

export type PlayColor = (typeof PLAY_COLORS)[number];
export type CardColor = PlayColor | "wild";

export type CardType =
  | "number"
  | "skip"
  | "reverse"
  | "draw-two"
  | "wild"
  | "wild-draw-four";

export type Card = {
  id: string;
  color: CardColor;
  type: CardType;
  /** 0-9 for number cards, null otherwise. */
  value: number | null;
};

export type GamePhase = "lobby" | "playing" | "finished";

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 10;
export const DEFAULT_MAX_PLAYERS = 4;
export const INITIAL_HAND_SIZE = 7;
export const UNO_PENALTY = 2;
/**
 * Carência, em ms, entre alguém ficar com uma carta e os outros poderem pegá-lo.
 * Sem ela a corrida é injusta: o "Pegar" nasce debaixo do cursor de quem já está
 * esperando, enquanto quem tem que gritar ainda precisa reagir e mirar.
 */
export const UNO_GRACE = 50;
/**
 * Quanto tempo, em ms, a roleta do sorteio gira antes de as cartas serem
 * repartidas. É o servidor que conta: o sorteado já está decidido quando a
 * roleta começa, e o que este número compra é a mesa inteira vendo a mesma
 * volta ao mesmo tempo. Curto demais e ninguém lê o nome; longo demais e vira
 * pedágio entre apertar "Começar" e jogar — dois segundos e meio é uma volta
 * que desacelera, para e ainda deixa o nome parado por um instante.
 */
export const STARTER_SPIN = 2600;
/**
 * Segundos que um jogador caído mantém o lugar durante a partida. Segurar o
 * lugar por muito tempo é o que trava a mesa quando a queda é na vez dele: os
 * outros ficam olhando um relógio que não é deles. Um minuto e meio é o que
 * cobre um elevador ou um túnel sem transformar a partida em sala de espera.
 */
export const RECONNECT_TIMEOUT = 90;
/**
 * O mesmo, fora da partida — e aqui pode ser generoso, porque ninguém está
 * esperando uma vez. O caso comum não é a internet cair: é o host sair do
 * navegador para mandar o link no WhatsApp. O celular congela a aba, o socket
 * morre, e a mesa recém-criada, que só tem ele, some junto. Enquanto o lugar
 * está guardado a sala continua de pé, então este número é também o tempo que
 * uma mesa vazia sobrevive ao seu criador.
 */
export const LOBBY_RECONNECT_TIMEOUT = 300;

/* ------------------------------------------------------------ regras da casa */

/**
 * As variações opcionais do jogo. Escolhidas ao abrir a mesa e imutáveis
 * depois: a partida inteira é jogada sob o mesmo combinado, e quem entra pelo
 * link lê no lobby o que já foi combinado.
 */
export type HouseRules = {
  /** +2 e +4 podem ser respondidos com outro do mesmo tipo, acumulando a compra. */
  stacking: boolean;
  /** Sem jogada, compra-se até vir uma carta que sirva, e não uma só. */
  drawUntilPlayable: boolean;
};

export const DEFAULT_RULES: HouseRules = { stacking: false, drawUntilPlayable: false };

/**
 * A lista que a tela inicial vira checkbox e o lobby vira texto. Uma regra nova
 * é uma linha aqui e um campo em `HouseRules` — nenhuma tela precisa saber
 * quais regras existem.
 */
export const RULES: { key: keyof HouseRules; label: string; hint: string }[] = [
  {
    key: "stacking",
    label: "Empilhar +2 e +4",
    hint: "Responda um +2 com outro +2, ou um +4 com outro +4, e quem não tiver compra tudo. Nunca cruzado, e uma carta por vez.",
  },
  {
    key: "drawUntilPlayable",
    label: "Comprar até achar",
    hint: "Sem jogada na mão, compre até vir uma carta que sirva — e então baixe essa carta ou passe a vez.",
  },
];

export const isWild = (card: Card) =>
  card.type === "wild" || card.type === "wild-draw-four";

/** O nome de cada cor, em português. É o vocabulário do log e da interface. */
export const COLOR_NAME: Record<CardColor, string> = {
  red: "vermelho",
  yellow: "amarelo",
  green: "verde",
  blue: "azul",
  wild: "",
};

export function cardLabel(card: Card): string {
  switch (card.type) {
    case "number":
      return `${card.value} ${COLOR_NAME[card.color]}`;
    case "skip":
      return `bloqueio ${COLOR_NAME[card.color]}`;
    case "reverse":
      return `inverte ${COLOR_NAME[card.color]}`;
    case "draw-two":
      return `+2 ${COLOR_NAME[card.color]}`;
    case "wild":
      return "coringa troca cor";
    case "wild-draw-four":
      return "coringa +4";
  }
}

const ART_FACE: Record<CardType, string> = {
  number: "",
  skip: "skip",
  reverse: "reverse",
  "draw-two": "draw2",
  wild: "change",
  "wild-draw-four": "draw4",
};

/** File stem of the artwork for a card, e.g. `uno-red-7` or `uno-wild-draw4`. */
export function cardArt(card: Pick<Card, "color" | "type" | "value">): string {
  const face = card.type === "number" ? card.value : ART_FACE[card.type];
  return `uno-${card.color}-${face}`;
}

/* ---------------------------------------------------------------- protocol */

/**
 * The public room state, exactly as the clients receive it.
 * `UnoRoomState` on the server is the schema that produces this shape.
 */
export type PublicCard = {
  id: string;
  color: CardColor;
  kind: CardType;
  /** 0-9 on number cards, -1 on the others. */
  value: number;
};

export type PublicPlayer = {
  id: string;
  name: string;
  cardCount: number;
  connected: boolean;
  calledUno: boolean;
};

export type TableState = {
  roomName: string;
  hostId: string;
  phase: GamePhase;
  maxPlayers: number;
  rules: HouseRules;
  players: PublicPlayer[];
  currentPlayerId: string;
  /** O sorteado, enquanto a roleta gira. Vazio fora do sorteio. */
  starterId: string;
  currentColor: PlayColor | "";
  direction: 1 | -1;
  pendingDraw: number;
  deckCount: number;
  discardCount: number;
  discard: PublicCard[];
  winnerId: string;
  vulnerablePlayerId: string;
  /** A carência passou: os outros já podem pegar quem está exposto. */
  catchOpen: boolean;
  mustPlayDrawn: boolean;
  log: string[];
};

export const toCard = (card: PublicCard): Card => ({
  id: card.id,
  color: card.color,
  type: card.kind,
  value: card.value < 0 ? null : card.value,
});


export type CreateRoomOptions = {
  roomName: string;
  playerName: string;
  maxPlayers: number;
  rules: HouseRules;
};

export type JoinRoomOptions = {
  playerName: string;
};

/** client -> server */
export type PlayMessage = { cardId: string; color?: PlayColor };
export type CatchMessage = { targetId: string };

/** server -> client, private to a single player */
export type HandMessage = { cards: Card[]; playableIds: string[] };
export type ErrorMessage = { message: string };

/**
 * O que ACONTECEU, e não o que passou a ser — o estado sincronizado só conta o
 * segundo. Sem isto o cliente teria que adivinhar por diferença de contadores,
 * e há duas jogadas em que a diferença mente: comprar e jogar dentro do mesmo
 * patch (o contador da mão volta ao que era) e o reembaralhar (o monte sobe e o
 * descarte cai, exatamente como se todo mundo tivesse comprado de uma vez).
 *
 * A mesa usa isso só para animar. Nenhuma regra depende destes eventos.
 */
export type FxEvent =
  /** Reparto inicial: n cartas do monte para a mão de `to`. */
  | { k: "deal"; to: string; n: number }
  /** Compra do turno, o +2/+4 pendente ou a penalidade do UNO. */
  | { k: "draw"; to: string; n: number }
  /** `by` baixou uma carta: a de cima do descarte, que já vem no estado. */
  | { k: "play"; by: string }
  /** A carta que abre a partida, virada do monte para o descarte. */
  | { k: "flip" }
  /** A compra acabou e o descarte virou baralho de novo. */
  | { k: "recycle" };

/** server -> client, broadcast. Vem antes do patch de estado correspondente. */
export type FxMessage = FxEvent[];
