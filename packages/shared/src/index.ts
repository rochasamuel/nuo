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
 * Quanto tempo, em ms, o tapa no 9 espera antes de se resolver sozinho.
 *
 * Não é o tempo da brincadeira — ela acaba sozinha no instante em que sobra um
 * só. É a rede para a mesa que travou: alguém caiu, alguém foi atender a porta,
 * e sem isto a partida esperaria por uma mão que não vem. Cinco segundos é
 * muito mais do que qualquer tapa honesto leva, que é como tem que ser: a rede
 * não pode competir com a corrida.
 */
export const SLAP_TIMEOUT = 5000;
/**
 * Quanto tempo, em ms, a mesa espera a escolha da troca no 7 antes de escolher
 * sozinha.
 *
 * É a mesma rede de segurança do tapa, mas para uma decisão de natureza
 * oposta: o tapa é reflexo e se resolve em um segundo, enquanto escolher com
 * quem trocar é ler a mesa inteira — quantas cartas cada um tem, quem está
 * prestes a bater — com todo mundo esperando. Vinte segundos é folgado de
 * propósito: quem estiver pensando não pode ser atropelado pela rede, e ela só
 * precisa cobrir a mesa que travou porque alguém sumiu no meio da vez.
 */
export const SWAP_TIMEOUT = 20000;
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
  /** Todo 9 baixado abre uma corrida: quem bater por último compra. */
  slapNine: boolean;
  /** Quem baixa um 7 troca a mão inteira com um jogador à sua escolha. */
  sevenSwap: boolean;
  /** Todo 0 baixado passa a mesa inteira: cada mão vai para o próximo jogador. */
  zeroRotate: boolean;
};

export const DEFAULT_RULES: HouseRules = {
  stacking: false,
  drawUntilPlayable: false,
  slapNine: false,
  sevenSwap: false,
  zeroRotate: false,
};

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
    hint: "Sem jogada na mão, compre até vir uma carta que sirva — e então é obrigatório baixá-la. Aqui não se passa a vez.",
  },
  {
    key: "slapNine",
    label: "Tapa no 9",
    hint: "Todo 9 baixado para a mesa: todo mundo bate na carta, inclusive quem jogou. O último compra uma.",
  },
  {
    key: "sevenSwap",
    label: "Troca no 7",
    hint: "Baixou um 7, troca a mão inteira com quem quiser da mesa. Não é opção: escolher faz parte da jogada.",
  },
  {
    key: "zeroRotate",
    label: "Roda no 0",
    hint: "Baixou um 0, a mesa inteira anda: cada um passa a mão para o próximo, no sentido em que o jogo está correndo.",
  },
];

/* ------------------------------------------------------------ conversa */

/**
 * O vocabulário da mesa. É fechado de propósito: com ele não se ofende, não se
 * combina jogada por fora e não se digita nada em partida — cada emoji é uma
 * frase inteira. A lista é a mesma dos dois lados, e o servidor só aceita o que
 * está aqui; um emoji novo é uma linha neste array e mais nada.
 *
 * A ordem é a da grade na tela, lida da esquerda para a direita: primeiro o que
 * se diz sobre a jogada dos outros, depois o que se diz sobre a própria.
 */
export const EMOTES = [
  "😂",
  "😱",
  "😡",
  "😭",
  "👏",
  "👍",
  "👎",
  "🤔",
  "😎",
  "🙏",
] as const;

export type Emote = (typeof EMOTES)[number];

export const isEmote = (value: unknown): value is Emote =>
  EMOTES.includes(value as Emote);

/**
 * Quanto tempo, em ms, um jogador espera entre dois emojis.
 *
 * Não é moderação, é ritmo: sem isto a mesa vira metralhadora de balões e a
 * conversa deixa de ser legível justamente para quem está tentando jogar. Um
 * segundo e meio deixa reagir a uma jogada e ainda emendar um segundo emoji,
 * mas não deixa segurar o botão.
 */
export const EMOTE_COOLDOWN = 1500;

/**
 * Quanto tempo, em ms, o balão fica na tela antes de sumir sozinho.
 *
 * Um emoji é um instante, não uma situação: ele acompanha a jogada que
 * comentou e vai embora com ela. Três segundos é o que alguém do outro lado da
 * mesa leva para olhar para cima, ler e voltar para a própria mão.
 */
export const EMOTE_LINGER = 3000;

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
  /**
   * Quem está com uma carta na mão sem ter gritado UNO. Lista, e não um nome:
   * a roda do 0 pode deixar meia mesa com uma carta só no mesmo instante.
   */
  vulnerablePlayerIds: string[];
  /** A carência passou: os outros já podem pegar quem está exposto. */
  catchOpen: boolean;
  mustPlayDrawn: boolean;
  /**
   * Quem ainda deve um tapa no 9 que está no topo do descarte. Lista vazia é o
   * caso normal: não há tapa aberto, e a mesa não está congelada.
   */
  slapPending: string[];
  /**
   * Quem baixou um 7 e ainda deve escolher com quem trocar. Vazio é o caso
   * normal; preenchido é uma mesa parada esperando essa escolha.
   */
  swapChooserId: string;
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
export type SwapMessage = { targetId: string };
export type EmoteMessage = { emote: Emote };

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
  | { k: "recycle" }
  /**
   * `by` bateu no 9. Aqui a diferença de estado mente igual aos outros casos: o
   * patch que fecha a rodada tira duas mãos da lista de uma vez — a de quem
   * bateu e a de quem perdeu — e olhando só o antes e o depois não há como
   * separá-las. Sem este evento, o tapa que decide a corrida seria mudo.
   */
  | { k: "slap"; by: string }
  /**
   * As duas mãos de `a` e `b` trocaram de dono. Aqui a diferença de estado não
   * mente — os dois contadores mudam —, mas ela não diz de onde para onde: sem
   * este evento a mesa veria dois números novos e nenhuma carta atravessando.
   */
  | { k: "swap"; a: string; b: string }
  /**
   * A mesa inteira andou uma casa: cada `id` desta lista passou a mão para o
   * seguinte, e o último para o primeiro. Vem na ordem do jogo, já com a
   * direção aplicada — quem anima não precisa saber para que lado a mesa corre.
   */
  | { k: "rotate"; ids: string[] };

/** server -> client, broadcast. Vem antes do patch de estado correspondente. */
export type FxMessage = FxEvent[];

/**
 * server -> client, broadcast. Quem falou e o que disse.
 *
 * Fora do estado sincronizado pelo mesmo motivo dos eventos de `fx`: um emoji
 * é o que ACONTECEU, e some sozinho. No schema ele obrigaria a mesa inteira a
 * receber um patch para pôr o balão e outro para tirá-lo — e ainda ressuscitaria
 * na tela de quem entrasse depois, comentando uma jogada que já passou.
 */
export type EmoteEvent = { by: string; emote: Emote };
