import { describe, expect, it } from "vitest";
import {
  INITIAL_HAND_SIZE,
  UNO_GRACE,
  UNO_PENALTY,
  type Card,
  type CardType,
  type PlayColor,
} from "@uno/shared";
import { createDeck } from "./deck.js";
import { canPlay } from "./rules.js";
import { GameError, UnoGame } from "./UnoGame.js";

/** Deterministic PRNG so a failing test always fails the same way. */
function seeded(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const card = (
  id: string,
  color: Card["color"],
  type: CardType,
  value: number | null = null,
): Card => ({ id, color, type, value });

/** Uma mesa sentada e ainda no lobby, para quem testa o que acontece ao começar. */
function newTable(random: () => number, playerCount = 3) {
  const game = new UnoGame(random);
  for (let i = 0; i < playerCount; i++) game.addPlayer(`p${i}`, `k${i}`, `P${i}`);
  return game;
}

/** A started game normalized to a neutral position: red 5 on top, first player to act. */
function newGame(playerCount = 3) {
  const game = new UnoGame(seeded(7));
  for (let i = 0; i < playerCount; i++) game.addPlayer(`p${i}`, `k${i}`, `P${i}`);
  game.start();
  game.discard = [card("top", "red", "number", 5)];
  game.currentColor = "red";
  game.currentIndex = 0;
  game.direction = 1;
  game.pendingDraw = 0;
  game.drawnCardId = null;
  return game;
}

/** Replaces a hand so the scenario under test is the only thing that can happen. */
function setHand(game: UnoGame, index: number, cards: Card[]) {
  game.players[index].hand = cards;
}

/** Unplayable spare card, so playing the card under test does not win the game. */
const filler = () => card("filler", "blue", "number", 0);

/** Mesma mesa, mas com o relógio na mão: a carência do UNO depende dele. */
function timedGame(playerCount = 3) {
  let clock = 1_000_000;
  const game = new UnoGame(seeded(7), () => clock);
  for (let i = 0; i < playerCount; i++) game.addPlayer(`p${i}`, `k${i}`, `P${i}`);
  game.start();
  game.discard = [card("top", "red", "number", 5)];
  game.currentColor = "red";
  game.currentIndex = 0;
  game.direction = 1;
  game.pendingDraw = 0;
  game.drawnCardId = null;
  return { game, tick: (ms: number) => (clock += ms) };
}

describe("deck", () => {
  const deck = createDeck();

  it("has 108 cards with unique ids", () => {
    expect(deck).toHaveLength(108);
    expect(new Set(deck.map((c) => c.id)).size).toBe(108);
  });

  it("has one zero and two of each 1-9 per color", () => {
    const red = deck.filter((c) => c.color === "red" && c.type === "number");
    expect(red.filter((c) => c.value === 0)).toHaveLength(1);
    expect(red.filter((c) => c.value === 7)).toHaveLength(2);
    expect(red).toHaveLength(19);
  });

  it("has two of each action per color and eight wilds", () => {
    const count = (type: CardType) => deck.filter((c) => c.type === type).length;
    expect(count("skip")).toBe(8);
    expect(count("reverse")).toBe(8);
    expect(count("draw-two")).toBe(8);
    expect(count("wild")).toBe(4);
    expect(count("wild-draw-four")).toBe(4);
  });
});

describe("canPlay", () => {
  const top = card("t", "red", "number", 5);

  it("accepts a matching color", () => {
    expect(canPlay(card("a", "red", "number", 9), top, "red")).toBe(true);
  });

  it("accepts a matching number in another color", () => {
    expect(canPlay(card("a", "blue", "number", 5), top, "red")).toBe(true);
  });

  it("accepts a matching action in another color", () => {
    const skipTop = card("t", "red", "skip");
    expect(canPlay(card("a", "blue", "skip"), skipTop, "red")).toBe(true);
  });

  it("accepts any wild", () => {
    expect(canPlay(card("a", "wild", "wild"), top, "red")).toBe(true);
    expect(canPlay(card("a", "wild", "wild-draw-four"), top, "red")).toBe(true);
  });

  it("rejects a different color and face", () => {
    expect(canPlay(card("a", "blue", "number", 9), top, "red")).toBe(false);
  });

  it("follows the chosen color, not the color of the wild on top", () => {
    const wildTop = card("t", "wild", "wild");
    expect(canPlay(card("a", "green", "number", 3), wildTop, "green")).toBe(true);
    expect(canPlay(card("a", "red", "number", 3), wildTop, "green")).toBe(false);
  });
});

describe("start", () => {
  it("deals seven cards to everyone and never opens on a wild", () => {
    for (let seed = 0; seed < 30; seed++) {
      const game = new UnoGame(seeded(seed));
      game.addPlayer("a", "ka", "A");
      game.addPlayer("b", "kb", "B");
      game.start();
      expect(game.players.every((p) => p.hand.length === 7)).toBe(true);
      expect(game.topCard!.color).not.toBe("wild");
      expect(game.deck.length + game.discard.length + 14).toBe(108);
    }
  });

  it("refuses to start with a single player", () => {
    const game = new UnoGame(seeded(1));
    game.addPlayer("a", "ka", "A");
    expect(() => game.start()).toThrow(GameError);
  });

  /* O seed 7 abre num número: com um bloqueio ou um inverte na mesa a vez já
     teria andado, e o teste falaria da carta inicial em vez do sorteio. */
  it("begins on whoever was drafted", () => {
    const game = newTable(seeded(7));
    game.start("p2");
    expect(game.currentPlayer!.id).toBe("p2");
    expect(game.log).toContain("Sorteio: P2 começa a partida.");
  });

  it("falls back to the first seat when the drafted player left", () => {
    const game = newTable(seeded(7));
    game.start("gone");
    expect(game.currentPlayer!.id).toBe("p0");
  });
});

/*
 * O tapa no 9 é a única regra que tira o jogo da vez de alguém: enquanto ela
 * corre, a mesa está congelada e todo mundo age ao mesmo tempo. O que se testa
 * aqui é o começo, o fim e o que acontece quando a mesa muda no meio.
 */
describe("slap the nine", () => {
  /** Uma mesa com a regra ligada e um 9 na mão de p0, pronto para baixar. */
  function slapGame(playerCount = 3) {
    const game = newGame(playerCount);
    game.rules.slapNine = true;
    setHand(game, 0, [card("nine", "red", "number", 9), filler()]);
    return game;
  }

  it("freezes the table when a nine lands: everyone owes a slap", () => {
    const game = slapGame();
    game.playCard("p0", "nine");
    expect(game.slapPending).toEqual(["p0", "p1", "p2"]);
    // A vez não andou: quem baixou continua sendo o jogador atual.
    expect(game.currentPlayer!.id).toBe("p0");
  });

  it("stays out of the way when the rule is off", () => {
    const game = newGame(3);
    setHand(game, 0, [card("nine", "red", "number", 9), filler()]);
    game.playCard("p0", "nine");
    expect(game.slapPending).toEqual([]);
    expect(game.currentPlayer!.id).toBe("p1");
  });

  it("hands the card to the slowest and lets the turn move on", () => {
    const game = slapGame();
    game.playCard("p0", "nine");
    const before = game.players[1].hand.length;

    game.slap("p2");
    expect(game.slapPending).toEqual(["p0", "p1"]);
    game.slap("p0");

    // Sobrou p1: ele compra sem bater em nada, e a rodada acaba aqui.
    expect(game.slapPending).toEqual([]);
    expect(game.players[1].hand.length).toBe(before + 1);
    expect(game.currentPlayer!.id).toBe("p1");
    expect(game.log.at(-1)).toBe("P1 bateu por último e comprou uma carta.");
  });

  it("refuses a second slap from the same hand", () => {
    const game = slapGame();
    game.playCard("p0", "nine");
    game.slap("p2");
    expect(() => game.slap("p2")).toThrow(GameError);
  });

  it("refuses a slap when no nine is on the table", () => {
    expect(() => slapGame().slap("p0")).toThrow(GameError);
  });

  /* Congelada quer dizer congelada: sem isto, quem tem a vez baixa outra carta
     enquanto os outros ainda estão batendo e o alvo do tapa muda no meio. */
  it("blocks plays and draws while the slap is open", () => {
    const game = slapGame();
    game.playCard("p0", "nine");
    expect(() => game.playCard("p0", "filler")).toThrow(GameError);
    expect(() => game.drawCard("p0")).toThrow(GameError);
  });

  it("does not open on the nine that wins the game", () => {
    const game = slapGame();
    setHand(game, 0, [card("nine", "red", "number", 9)]);
    game.playCard("p0", "nine");
    expect(game.phase).toBe("finished");
    expect(game.slapPending).toEqual([]);
  });

  /* Quem sai da mesa não deve mais nada — e a saída pode ser o que decide a
     corrida, então a rodada tem que fechar na hora. */
  it("closes the round when leaving leaves a single debtor", () => {
    const game = slapGame();
    game.playCard("p0", "nine");
    game.slap("p0");
    const before = game.players[1].hand.length;

    game.removePlayer("p2");

    expect(game.slapPending).toEqual([]);
    expect(game.players.find((p) => p.id === "p1")!.hand.length).toBe(before + 1);
  });

  /* A rede de segurança: a mesa travou e a partida não pode esperar. Aqui todos
     os que devem pagam, e não só um. */
  it("punishes everyone still owing when the window times out", () => {
    const game = slapGame();
    game.playCard("p0", "nine");
    game.slap("p0");
    const before = [1, 2].map((i) => game.players[i].hand.length);

    game.timeoutSlap();

    expect(game.slapPending).toEqual([]);
    expect([1, 2].map((i) => game.players[i].hand.length)).toEqual([
      before[0] + 1,
      before[1] + 1,
    ]);
    expect(game.currentPlayer!.id).toBe("p1");
    // Mesa travada não é corrida perdida: o log tem que contar a outra história.
    expect(game.log.slice(-2)).toEqual([
      "P1 não bateu a tempo e comprou uma carta.",
      "P2 não bateu a tempo e comprou uma carta.",
    ]);
  });
});

/*
 * A troca no 7 é a outra regra que pendura o efeito da carta — e a única em que
 * a mesa inteira espera UMA pessoa decidir. O que se testa aqui é o que
 * acontece antes da escolha, depois dela, e quando ela não vem.
 */
describe("swap on the seven", () => {
  /** Uma mesa com a regra ligada e um 7 na mão de p0, pronto para baixar. */
  function swapGame(playerCount = 3) {
    const game = newGame(playerCount);
    game.rules.sevenSwap = true;
    setHand(game, 0, [card("seven", "red", "number", 7), filler()]);
    return game;
  }

  it("holds the table on a seven: whoever played it owes a choice", () => {
    const game = swapGame();
    game.playCard("p0", "seven");
    expect(game.swapChooserId).toBe("p0");
    // A vez não andou: o efeito do 7 está pendurado até a escolha sair.
    expect(game.currentPlayer!.id).toBe("p0");
  });

  it("stays out of the way when the rule is off", () => {
    const game = newGame(3);
    setHand(game, 0, [card("seven", "red", "number", 7), filler()]);
    game.playCard("p0", "seven");
    expect(game.swapChooserId).toBe("");
    expect(game.currentPlayer!.id).toBe("p1");
  });

  it("hands over the whole hand and lets the turn move on", () => {
    const game = swapGame();
    setHand(game, 2, [card("a", "blue", "number", 1), card("b", "green", "number", 2)]);
    game.playCard("p0", "seven");
    expect(game.players[0].hand.map((c) => c.id)).toEqual(["filler"]);

    game.chooseSwap("p0", "p2");

    expect(game.players[0].hand.map((c) => c.id)).toEqual(["a", "b"]);
    expect(game.players[2].hand.map((c) => c.id)).toEqual(["filler"]);
    expect(game.swapChooserId).toBe("");
    expect(game.currentPlayer!.id).toBe("p1");
    expect(game.log.at(-1)).toBe("P0 trocou de mão com P2.");
  });

  /* Numa mesa de dois não há escolha a fazer: perguntar seria pedir para
     confirmar o óbvio no meio da jogada. */
  it("swaps without asking when there is a single opponent", () => {
    const game = swapGame(2);
    setHand(game, 1, [card("a", "blue", "number", 1)]);
    game.playCard("p0", "seven");

    expect(game.swapChooserId).toBe("");
    expect(game.players[0].hand.map((c) => c.id)).toEqual(["a"]);
    expect(game.players[1].hand.map((c) => c.id)).toEqual(["filler"]);
    expect(game.currentPlayer!.id).toBe("p1");
  });

  it("refuses a choice that is not yours, or that lands on yourself", () => {
    const game = swapGame();
    game.playCard("p0", "seven");
    expect(() => game.chooseSwap("p1", "p2")).toThrow(GameError);
    expect(() => game.chooseSwap("p0", "p0")).toThrow(GameError);
    expect(() => game.chooseSwap("p0", "gone")).toThrow(GameError);
    expect(game.swapChooserId).toBe("p0");
  });

  it("refuses a choice when no seven is waiting for one", () => {
    expect(() => swapGame().chooseSwap("p0", "p1")).toThrow(GameError);
  });

  /* Parada quer dizer parada — inclusive para quem escolhe, cuja mão está
     justamente prestes a deixar de ser dele. */
  it("blocks plays and draws while the choice is open", () => {
    const game = swapGame();
    game.playCard("p0", "seven");
    expect(() => game.playCard("p0", "filler")).toThrow(GameError);
    expect(() => game.drawCard("p0")).toThrow(GameError);
    expect(() => game.playCard("p1", "whatever")).toThrow(GameError);
    expect(game.playableCards("p0")).toEqual([]);
  });

  it("does not open on the seven that wins the game", () => {
    const game = swapGame();
    setHand(game, 0, [card("seven", "red", "number", 7)]);
    game.playCard("p0", "seven");
    expect(game.phase).toBe("finished");
    expect(game.swapChooserId).toBe("");
  });

  /* A mão que chega ainda não foi anunciada: quem recebe uma carta só tem que
     gritar por ELA. Sem isto, trocar seria imunidade de graça — bastava gritar
     UNO, trocar por sete cartas e guardar o grito para a próxima. */
  it("resets the UNO call on both sides of the swap", () => {
    const { game, tick } = timedGame();
    game.rules.sevenSwap = true;
    setHand(game, 0, [card("seven", "red", "number", 7), filler(), card("x", "red", "number", 3)]);
    setHand(game, 2, [card("last", "blue", "number", 1)]);
    game.players[2].calledUno = true;

    game.playCard("p0", "seven");
    game.chooseSwap("p0", "p2");
    tick(UNO_GRACE);

    // p0 recebeu a mão de uma carta: exposto, e o grito antigo de p2 não o cobre.
    expect(game.players[0].calledUno).toBe(false);
    expect(game.players[2].calledUno).toBe(false);
    expect(game.vulnerable).toEqual(["p0"]);
    expect(game.catchOpen).toBe(true);
  });

  /* A exposição acompanha a mão, e não o dono: quem se livrou da última carta
     sai da linha de tiro, e quem a recebeu entra. */
  it("moves the exposure along with the last card", () => {
    const game = swapGame();
    setHand(game, 2, [card("a", "blue", "number", 1), card("b", "green", "number", 2)]);

    game.playCard("p0", "seven");
    // Baixou a penúltima: ficou com uma carta e exposto.
    expect(game.vulnerable).toEqual(["p0"]);

    game.chooseSwap("p0", "p2");
    expect(game.vulnerable).toEqual(["p2"]);
  });

  /* A rede de segurança: trocar é obrigatório, então o prazo não pode se
     resolver em "não trocou". */
  it("trades with the next player around when the window times out", () => {
    const game = swapGame();
    setHand(game, 1, [card("a", "blue", "number", 1)]);
    game.playCard("p0", "seven");

    game.timeoutSwap();

    expect(game.swapChooserId).toBe("");
    expect(game.players[0].hand.map((c) => c.id)).toEqual(["a"]);
    expect(game.players[1].hand.map((c) => c.id)).toEqual(["filler"]);
    expect(game.currentPlayer!.id).toBe("p1");
  });

  it("follows the direction of play when it picks for you", () => {
    const game = swapGame();
    game.direction = -1;
    setHand(game, 2, [card("a", "blue", "number", 1)]);
    game.playCard("p0", "seven");

    game.timeoutSwap();

    expect(game.players[0].hand.map((c) => c.id)).toEqual(["a"]);
  });

  /* Quem sai leva a troca com ele — e a vez já andou com o assento vago, então
     aplicar o efeito do 7 aqui pularia o próximo da roda. */
  it("drops the swap when whoever had to choose leaves the table", () => {
    const game = swapGame();
    game.playCard("p0", "seven");

    game.removePlayer("p0");

    expect(game.swapChooserId).toBe("");
    expect(game.currentPlayer!.id).toBe("p1");
    expect(game.phase).toBe("playing");
  });

  /* A saída pode ser a que termina a partida: se a troca não morresse junto, a
     mesa ficaria esperando a escolha de alguém que não está mais nela. */
  it("drops the swap when the table breaks up mid-choice", () => {
    const game = swapGame();
    game.playCard("p0", "seven");

    game.removePlayer("p1");
    game.removePlayer("p2");

    expect(game.phase).toBe("finished");
    expect(game.swapChooserId).toBe("");
  });

  it("names both sides of the swap for the animation", () => {
    const game = swapGame();
    game.playCard("p0", "seven");
    game.takeFx();
    game.chooseSwap("p0", "p2");
    expect(game.takeFx()).toEqual([{ k: "swap", a: "p0", b: "p2" }]);
  });
});

/*
 * A roda do 0 é a irmã da troca no 7, com a escolha tirada: quem decide é a
 * direção. Nada congela e nada fica pendurado — o que se testa aqui é para que
 * lado as mãos andam, e o que sobra do UNO quando a mesa inteira troca de mão.
 */
describe("rotate on the zero", () => {
  /** Uma mesa com a regra ligada e um 0 na mão de p0, pronto para baixar. */
  function zeroGame(playerCount = 3) {
    const game = newGame(playerCount);
    game.rules.zeroRotate = true;
    setHand(game, 0, [card("zero", "red", "number", 0), filler()]);
    return game;
  }

  /** As mãos da mesa, por assento, para comparar a volta inteira de uma vez. */
  const hands = (game: UnoGame) => game.players.map((p) => p.hand.map((c) => c.id));

  it("walks every hand one seat along, in play order", () => {
    const game = zeroGame();
    setHand(game, 1, [card("b", "blue", "number", 1), card("c", "blue", "number", 2)]);
    setHand(game, 2, [card("d", "green", "number", 3)]);

    game.playCard("p0", "zero");

    // p0 entregou ao p1, p1 ao p2, p2 ao p0 — e p0 baixou o 0 antes de entregar.
    expect(hands(game)).toEqual([["d"], ["filler"], ["b", "c"]]);
    // Nada ficou pendurado: a vez andou na mesma jogada.
    expect(game.currentPlayer!.id).toBe("p1");
  });

  it("walks the other way when the table is running backwards", () => {
    const game = zeroGame();
    game.direction = -1;
    setHand(game, 1, [card("b", "blue", "number", 1)]);
    setHand(game, 2, [card("d", "green", "number", 3), card("e", "green", "number", 4)]);

    game.playCard("p0", "zero");

    // Anti-horário: p0 entrega ao p2, p2 ao p1, p1 ao p0.
    expect(hands(game)).toEqual([["b"], ["d", "e"], ["filler"]]);
    expect(game.currentPlayer!.id).toBe("p2");
  });

  it("stays out of the way when the rule is off", () => {
    const game = newGame(3);
    setHand(game, 0, [card("zero", "red", "number", 0), filler()]);
    setHand(game, 1, [card("b", "blue", "number", 1)]);
    game.playCard("p0", "zero");
    expect(hands(game)[1]).toEqual(["b"]);
  });

  /* Com dois na mesa a roda é a troca: o próximo e o anterior são a mesma
     pessoa, e é assim que a regra tem que se comportar. */
  it("is a straight swap at a table of two", () => {
    const game = zeroGame(2);
    setHand(game, 1, [card("b", "blue", "number", 1)]);
    game.playCard("p0", "zero");
    expect(hands(game)).toEqual([["b"], ["filler"]]);
  });

  it("does not rotate on the zero that wins the game", () => {
    const game = zeroGame();
    setHand(game, 0, [card("zero", "red", "number", 0)]);
    setHand(game, 1, [card("b", "blue", "number", 1)]);
    game.playCard("p0", "zero");
    expect(game.phase).toBe("finished");
    expect(hands(game)[1]).toEqual(["b"]);
  });

  /* O caso que a lista de expostos existe para atender: a roda pode deixar
     meia mesa com uma carta na mão no mesmo instante, e com um lugar só as
     outras ganhariam imunidade de graça. */
  it("exposes everyone left holding a single card, all at once", () => {
    const { game, tick } = timedGame();
    game.rules.zeroRotate = true;
    setHand(game, 0, [card("zero", "red", "number", 0), filler()]);
    setHand(game, 1, [card("b", "blue", "number", 1)]);
    setHand(game, 2, [card("d", "green", "number", 3)]);
    game.players[1].calledUno = true;

    game.playCard("p0", "zero");
    tick(UNO_GRACE);

    expect(hands(game)).toEqual([["d"], ["filler"], ["b"]]);
    expect(game.vulnerable).toEqual(["p0", "p1", "p2"]);
    // O grito antigo não cobre a mão nova.
    expect(game.players.map((p) => p.calledUno)).toEqual([false, false, false]);
    expect(game.catchOpen).toBe(true);
  });

  /* Pegar um não absolve os outros: cada mão exposta é uma cobrança própria. */
  it("catches the exposed one by one", () => {
    const { game, tick } = timedGame();
    game.rules.zeroRotate = true;
    setHand(game, 0, [card("zero", "red", "number", 0), filler()]);
    setHand(game, 1, [card("b", "blue", "number", 1)]);
    setHand(game, 2, [card("d", "green", "number", 3)]);

    game.playCard("p0", "zero");
    tick(UNO_GRACE);
    game.catchUno("p1", "p0");

    expect(game.vulnerable).toEqual(["p1", "p2"]);
    expect(game.players[0].hand).toHaveLength(1 + UNO_PENALTY);
    // E gritar continua salvando quem gritou, sem mexer no resto.
    game.callUno("p1");
    expect(game.vulnerable).toEqual(["p2"]);
  });

  it("names the order of the rotation for the animation", () => {
    const game = zeroGame();
    game.direction = -1;
    game.takeFx();
    game.playCard("p0", "zero");
    expect(game.takeFx()).toEqual([
      { k: "play", by: "p0" },
      { k: "rotate", ids: ["p0", "p2", "p1"] },
    ]);
  });
});

describe("draft", () => {
  it("always draws someone who is at the table", () => {
    for (let seed = 0; seed < 30; seed++) {
      const game = newTable(seeded(seed), 4);
      expect(game.players.map((p) => p.id)).toContain(game.draftStarter());
    }
  });

  /* Sortear é o ponto do recurso: um sorteio que sempre cai no mesmo lugar é o
     host começando sempre, que é o que havia antes. */
  it("does not always land on the same seat", () => {
    const drawn = new Set<string>();
    for (let seed = 0; seed < 30; seed++) drawn.add(newTable(seeded(seed), 4).draftStarter());
    expect(drawn.size).toBeGreaterThan(1);
  });

  /* A recusa vem no sorteio, e não quando a roleta para: quem apertou o botão
     precisa ver o motivo enquanto ainda está olhando para ele. */
  it("refuses on a table that cannot start", () => {
    expect(() => newTable(seeded(1), 1).draftStarter()).toThrow(GameError);
    const started = newTable(seeded(1));
    started.start();
    expect(() => started.draftStarter()).toThrow(GameError);
  });
});

describe("turns", () => {
  it("moves to the next player after a number card", () => {
    const game = newGame(3);
    setHand(game, 0, [card("x", "red", "number", 3), filler()]);
    game.playCard("p0", "x");
    expect(game.currentPlayer!.id).toBe("p1");
  });

  it("rejects a play out of turn", () => {
    const game = newGame(3);
    setHand(game, 1, [card("x", "red", "number", 3)]);
    expect(() => game.playCard("p1", "x")).toThrow(/turno/);
  });

  it("rejects a card the player does not hold", () => {
    const game = newGame(3);
    setHand(game, 0, [card("x", "red", "number", 3)]);
    expect(() => game.playCard("p0", "ghost")).toThrow(/não tem essa carta/);
  });

  it("rejects a card that does not match", () => {
    const game = newGame(3);
    setHand(game, 0, [card("x", "blue", "number", 3)]);
    expect(() => game.playCard("p0", "x")).toThrow(/não combina/);
  });
});

describe("action cards", () => {
  it("skip jumps over the next player", () => {
    const game = newGame(3);
    setHand(game, 0, [card("x", "red", "skip"), filler()]);
    game.playCard("p0", "x");
    expect(game.currentPlayer!.id).toBe("p2");
  });

  it("reverse flips the direction", () => {
    const game = newGame(3);
    setHand(game, 0, [card("x", "red", "reverse"), filler()]);
    game.playCard("p0", "x");
    expect(game.direction).toBe(-1);
    expect(game.currentPlayer!.id).toBe("p2");
  });

  it("draw two makes the next player take two and lose the turn", () => {
    const game = newGame(3);
    setHand(game, 0, [card("x", "red", "draw-two"), filler()]);
    setHand(game, 1, [card("y", "red", "number", 1)]);
    game.playCard("p0", "x");

    expect(game.currentPlayer!.id).toBe("p1");
    expect(game.pendingDraw).toBe(2);
    expect(() => game.playCard("p1", "y")).toThrow(/precisa comprar/);

    game.drawCard("p1");
    expect(game.players[1].hand).toHaveLength(3);
    expect(game.pendingDraw).toBe(0);
    expect(game.currentPlayer!.id).toBe("p2");
  });

  it("wild sets the color in play", () => {
    const game = newGame(3);
    setHand(game, 0, [card("x", "wild", "wild"), filler()]);
    game.playCard("p0", "x", "green");
    expect(game.currentColor).toBe("green");
    expect(game.currentPlayer!.id).toBe("p1");
  });

  it("rejects a wild without a color", () => {
    const game = newGame(3);
    setHand(game, 0, [card("x", "wild", "wild")]);
    expect(() => game.playCard("p0", "x")).toThrow(/cor válida/);
    expect(() => game.playCard("p0", "x", "wild" as PlayColor)).toThrow(/cor válida/);
  });

  it("wild draw four makes the next player take four and lose the turn", () => {
    const game = newGame(3);
    setHand(game, 0, [card("x", "wild", "wild-draw-four"), filler()]);
    game.playCard("p0", "x", "blue");

    expect(game.currentColor).toBe("blue");
    expect(game.pendingDraw).toBe(4);
    game.drawCard("p1");
    expect(game.players[1].hand).toHaveLength(11);
    expect(game.currentPlayer!.id).toBe("p2");
  });
});

describe("stacking", () => {
  /** Mesa com a regra ligada e um +2 já pendente sobre p1. */
  function stackedGame() {
    const game = newGame(3);
    game.rules.stacking = true;
    setHand(game, 0, [card("x", "red", "draw-two"), filler()]);
    game.playCard("p0", "x");
    return game;
  }

  it("lets a draw two answer a draw two, adding to the pile", () => {
    const game = stackedGame();
    setHand(game, 1, [card("y", "blue", "draw-two"), filler()]);
    game.playCard("p1", "y");

    expect(game.pendingDraw).toBe(4);
    expect(game.currentPlayer!.id).toBe("p2");
  });

  it("hands the whole pile to whoever stops stacking", () => {
    const game = stackedGame();
    setHand(game, 1, [card("y", "blue", "draw-two"), filler()]);
    game.playCard("p1", "y");
    setHand(game, 2, [card("z", "green", "draw-two"), filler()]);
    game.playCard("p2", "z");

    expect(game.pendingDraw).toBe(6);
    game.drawCard("p0");
    expect(game.players[0].hand).toHaveLength(7);
    expect(game.pendingDraw).toBe(0);
    expect(game.currentPlayer!.id).toBe("p1");
  });

  it("never crosses the two types", () => {
    const game = stackedGame();
    setHand(game, 1, [card("y", "wild", "wild-draw-four"), filler()]);
    expect(() => game.playCard("p1", "y", "blue")).toThrow(/precisa comprar/);

    const four = newGame(3);
    four.rules.stacking = true;
    setHand(four, 0, [card("x", "wild", "wild-draw-four"), filler()]);
    four.playCard("p0", "x", "red");
    setHand(four, 1, [card("y", "red", "draw-two"), filler()]);
    expect(() => four.playCard("p1", "y")).toThrow(/precisa comprar/);
  });

  it("stacks draw fours on each other", () => {
    const game = newGame(3);
    game.rules.stacking = true;
    setHand(game, 0, [card("x", "wild", "wild-draw-four"), filler()]);
    game.playCard("p0", "x", "red");
    setHand(game, 1, [card("y", "wild", "wild-draw-four"), filler()]);
    game.playCard("p1", "y", "green");

    expect(game.pendingDraw).toBe(8);
    expect(game.currentColor).toBe("green");
  });

  it("offers only the stackable cards while the pile is open", () => {
    const game = stackedGame();
    setHand(game, 1, [
      card("y", "blue", "draw-two"),
      card("n", "red", "number", 5),
      card("w", "wild", "wild"),
    ]);
    expect(game.playableCards("p1").map((c) => c.id)).toEqual(["y"]);
  });

  it("stays off when the table did not ask for it", () => {
    const game = newGame(3);
    setHand(game, 0, [card("x", "red", "draw-two"), filler()]);
    game.playCard("p0", "x");
    setHand(game, 1, [card("y", "blue", "draw-two"), filler()]);

    expect(() => game.playCard("p1", "y")).toThrow(/precisa comprar/);
    expect(game.playableCards("p1")).toEqual([]);
  });
});

describe("what the table is told", () => {
  it("names the color chosen for a wild", () => {
    const game = newGame(3);
    setHand(game, 0, [card("x", "wild", "wild"), filler()]);
    game.playCard("p0", "x", "green");
    expect(game.log.at(-1)).toBe("P0 jogou coringa troca cor e escolheu verde.");
  });

  it("says who gave up the turn", () => {
    const game = newGame(3);
    setHand(game, 0, [filler()]);
    game.deck = [card("d1", "red", "number", 3)];
    game.drawCard("p0");
    game.pass("p0");
    expect(game.log.at(-1)).toBe("P0 passou a vez.");
  });
});

describe("draw until playable", () => {
  /** O monte sai do fim: as duas primeiras compras não servem, a terceira sim. */
  function stackedDeck(game: UnoGame) {
    game.deck = [card("d3", "red", "number", 3), card("d2", "blue", "number", 9), card("d1", "blue", "number", 8)];
  }

  it("keeps drawing until a card fits, then stops on it", () => {
    const game = newGame(3);
    game.rules.drawUntilPlayable = true;
    setHand(game, 0, [filler()]);
    stackedDeck(game);
    game.drawCard("p0");

    expect(game.players[0].hand).toHaveLength(4);
    expect(game.currentPlayer!.id).toBe("p0");
    expect(game.playableCards("p0").map((c) => c.id)).toEqual(["d3"]);
  });

  it("takes a single card when the table did not ask for it", () => {
    const game = newGame(3);
    setHand(game, 0, [filler()]);
    stackedDeck(game);
    game.drawCard("p0");

    expect(game.players[0].hand).toHaveLength(2);
    expect(game.currentPlayer!.id).toBe("p1");
  });

  it("gives up the turn when the cards run out first", () => {
    const game = newGame(3);
    game.rules.drawUntilPlayable = true;
    setHand(game, 0, [filler()]);
    game.deck = [card("d1", "blue", "number", 8)];
    game.drawCard("p0");

    expect(game.players[0].hand).toHaveLength(2);
    expect(game.currentPlayer!.id).toBe("p1");
  });

  /* Comprar até achar é uma busca com destino: passar depois de achar
     devolveria a escolha que a regra tirou, e as cartas compradas no caminho
     não teriam servido para nada. */
  it("refuses to pass once the search has found its card", () => {
    const game = newGame(3);
    game.rules.drawUntilPlayable = true;
    setHand(game, 0, [filler()]);
    stackedDeck(game);
    game.drawCard("p0");

    expect(() => game.pass("p0")).toThrow(/obrigatório jogar/);
    expect(game.currentPlayer!.id).toBe("p0");

    // E a saída existe: a carta achada é sempre jogável.
    game.playCard("p0", "d3");
    expect(game.currentPlayer!.id).toBe("p1");
  });

  /* Sem a regra a compra é de uma carta só, e aí passar continua sendo o
     direito de quem comprou. */
  it("still lets a single drawn card be passed on when the rule is off", () => {
    const game = newGame(3);
    setHand(game, 0, [filler()]);
    game.deck = [card("d3", "red", "number", 3)];
    game.drawCard("p0");

    game.pass("p0");
    expect(game.currentPlayer!.id).toBe("p1");
  });
});

describe("drawing", () => {
  it("refuses the draw while the player still holds a playable card", () => {
    const game = newGame(3);
    setHand(game, 0, [card("x", "red", "number", 3), filler()]);
    expect(() => game.drawCard("p0")).toThrow(/só compre quando não puder jogar/);
    expect(game.players[0].hand).toHaveLength(2);
  });

  it("leaves drawing as the only move when nothing matches", () => {
    const game = newGame(3);
    setHand(game, 0, [card("x", "blue", "number", 3), card("y", "green", "number", 8)]);
    expect(game.playableCards("p0")).toHaveLength(0);
    expect(() => game.playCard("p0", "x")).toThrow(/não combina/);
    expect(() => game.pass("p0")).toThrow(/depois de comprar/);
    game.deck = [card("d", "blue", "number", 9)];
    game.drawCard("p0");
    expect(game.players[0].hand).toHaveLength(3);
  });

  it("passes the turn when the drawn card is unplayable", () => {
    const game = newGame(3);
    setHand(game, 0, []);
    game.deck = [card("d", "blue", "number", 9)];
    game.drawCard("p0");
    expect(game.players[0].hand).toHaveLength(1);
    expect(game.currentPlayer!.id).toBe("p1");
  });

  it("lets the player use the drawn card, but only that one", () => {
    const game = newGame(3);
    setHand(game, 0, [card("other", "blue", "number", 2)]);
    game.deck = [card("d", "red", "number", 9)];
    game.drawCard("p0");

    expect(game.currentPlayer!.id).toBe("p0");
    expect(game.playableCards("p0").map((c) => c.id)).toEqual(["d"]);
    expect(() => game.playCard("p0", "other")).toThrow(/já comprou/);

    game.playCard("p0", "d");
    expect(game.currentPlayer!.id).toBe("p1");
  });

  it("allows passing only after a draw", () => {
    const game = newGame(3);
    setHand(game, 0, [card("other", "blue", "number", 2)]);
    expect(() => game.pass("p0")).toThrow(/depois de comprar/);

    game.deck = [card("d", "red", "number", 9)];
    game.drawCard("p0");
    game.pass("p0");
    expect(game.currentPlayer!.id).toBe("p1");
  });

  /*
   * Uma compra recusada não pode ter mexido em nada: a sala só sincroniza
   * depois de a ação passar, então o que mudar antes de um `throw` vira uma
   * diferença entre servidor e mesa que ninguém corrige.
   */
  it("leaves the table untouched when the draw is refused", () => {
    const game = newGame(3);
    setHand(game, 0, [card("x", "red", "number", 3), filler()]);
    game.vulnerable = ["p1"];

    expect(() => game.drawCard("p0")).toThrow(/só compre quando não puder jogar/);
    expect(game.vulnerable).toEqual(["p1"]);
  });

  it("leaves the table untouched when the draw is refused after another draw", () => {
    const game = newGame(3);
    setHand(game, 0, [card("other", "blue", "number", 2)]);
    game.deck = [card("d", "red", "number", 9)];
    game.drawCard("p0");
    game.vulnerable = ["p1"];

    expect(() => game.drawCard("p0")).toThrow(/já comprou/);
    expect(game.vulnerable).toEqual(["p1"]);
  });

  it("recycles the discard pile when the deck runs out", () => {
    const game = newGame(3);
    setHand(game, 0, []);
    game.deck = [];
    game.discard = [
      card("a", "blue", "number", 1),
      card("b", "green", "number", 2),
      card("top", "red", "number", 5),
    ];
    game.drawCard("p0");
    expect(game.players[0].hand).toHaveLength(1);
    expect(game.discard.map((c) => c.id)).toEqual(["top"]);
  });
});

describe("uno", () => {
  it("marks a player who reaches one card without calling it", () => {
    const { game, tick } = timedGame();
    setHand(game, 0, [card("x", "red", "number", 3), card("y", "blue", "number", 4)]);
    game.playCard("p0", "x");
    expect(game.vulnerable).toEqual(["p0"]);

    tick(UNO_GRACE);
    game.catchUno("p1", "p0");
    expect(game.players[0].hand).toHaveLength(3);
    expect(game.vulnerable).toEqual([]);
  });

  it("holds the catch during the grace, so camping the button cannot win the race", () => {
    const { game, tick } = timedGame();
    setHand(game, 0, [card("x", "red", "number", 3), card("y", "blue", "number", 4)]);
    game.playCard("p0", "x");

    expect(game.catchOpen).toBe(false);
    expect(() => game.catchUno("p1", "p0")).toThrow(/ainda pode gritar/);

    tick(UNO_GRACE - 1); // clicando o tempo todo, até um piscar antes
    expect(() => game.catchUno("p1", "p0")).toThrow(/ainda pode gritar/);
    expect(game.players[0].hand).toHaveLength(1); // nenhuma carta de penalidade

    tick(1);
    expect(game.catchOpen).toBe(true);
    game.catchUno("p1", "p0");
    expect(game.players[0].hand).toHaveLength(3);
  });

  it("lets the exposed player save themselves inside the grace", () => {
    const { game, tick } = timedGame();
    setHand(game, 0, [card("x", "red", "number", 3), card("y", "blue", "number", 4)]);
    game.playCard("p0", "x");

    tick(UNO_GRACE - 500); // reagiu antes de a janela abrir
    game.callUno("p0");

    tick(5000);
    expect(game.catchOpen).toBe(false);
    expect(() => game.catchUno("p1", "p0")).toThrow(/ninguém para pegar/);
  });

  it("protects a player who calls uno right after playing", () => {
    const game = newGame(3);
    setHand(game, 0, [card("x", "red", "number", 3), card("y", "blue", "number", 4)]);
    game.playCard("p0", "x");
    expect(game.vulnerable).toEqual(["p0"]);

    game.callUno("p0");
    expect(game.vulnerable).toEqual([]);
    expect(() => game.catchUno("p1", "p0")).toThrow(/ninguém para pegar/);
  });

  it("refuses the call before the last card, so it cannot be armed in advance", () => {
    const game = newGame(3);
    setHand(game, 0, [card("x", "red", "number", 3), card("y", "blue", "number", 4)]);
    expect(() => game.callUno("p0")).toThrow(/assim que ficar com uma carta/);

    game.playCard("p0", "x");
    expect(game.vulnerable).toEqual(["p0"]); // sem o atalho, ele fica exposto
  });

  it("refuses a repeated call, so spamming the button does nothing", () => {
    const game = newGame(3);
    setHand(game, 0, [card("x", "red", "number", 3), card("y", "blue", "number", 4)]);
    game.playCard("p0", "x");
    game.callUno("p0");
    const entries = game.log.length;

    expect(() => game.callUno("p0")).toThrow(/já gritou UNO/);
    expect(game.log).toHaveLength(entries); // nada novo foi para a mesa
  });

  it("closes the window once the next player acts", () => {
    const game = newGame(3);
    setHand(game, 0, [card("x", "red", "number", 3), card("y", "blue", "number", 4)]);
    setHand(game, 1, [card("z", "red", "number", 8), filler()]);
    game.playCard("p0", "x");
    game.playCard("p1", "z");
    expect(() => game.catchUno("p2", "p0")).toThrow(/ninguém para pegar/);
    expect(game.catchOpen).toBe(false);
  });

  it("refuses the call with a full hand", () => {
    const game = newGame(3);
    expect(() => game.callUno("p0")).toThrow(/assim que ficar com uma carta/);
  });
});

describe("victory", () => {
  it("ends the game when a hand empties", () => {
    const game = newGame(3);
    setHand(game, 0, [card("x", "red", "number", 3)]);
    game.playCard("p0", "x");
    expect(game.phase).toBe("finished");
    expect(game.winnerId).toBe("p0");
    expect(() => game.drawCard("p1")).toThrow(/não está em andamento/);
  });

  /*
   * A última carta ganha a partida, e o efeito dela não acontece.
   *
   * Esvaziar a mão é o fim, e o fim vem antes de tudo: o `playCard` devolve no
   * instante em que a mão zera, antes do tapa, da troca e da roda. Vale como
   * regra da casa — "quem bate, bateu" — e é também a saída mais segura das
   * duas.
   *
   * A outra seria deixar o efeito acontecer primeiro, e ela abre um buraco: um
   * 7 baixado como última carta numa mesa de dois passaria a mão VAZIA para o
   * adversário, e nada no jogo procura uma mão vazia fora do `playCard`. A
   * partida seguiria com alguém sem cartas e sem ninguém para declarar
   * vencedor. Estes testes existem para que a ordem não se inverta sem querer.
   */
  it("wins on the last card without firing its rule", () => {
    const cases = [
      { rule: "zeroRotate", value: 0, id: "z" },
      { rule: "sevenSwap", value: 7, id: "s" },
      { rule: "slapNine", value: 9, id: "n" },
    ] as const;

    for (const { rule, value, id } of cases) {
      const game = newGame(3);
      game.rules[rule] = true;
      setHand(game, 0, [card(id, "red", "number", value)]);
      setHand(game, 1, [card("a", "blue", "number", 1)]);
      setHand(game, 2, [card("b", "blue", "number", 2)]);
      game.playCard("p0", id);

      expect(game.phase).toBe("finished");
      expect(game.winnerId).toBe("p0");
      // Nada ficou pendurado: a mesa acabada não pede tapa nem escolha, e as
      // mãos dos outros continuam onde estavam.
      expect(game.slapPending).toEqual([]);
      expect(game.swapChooserId).toBe("");
      expect(game.players.map((p) => p.hand.length)).toEqual([0, 1, 1]);
    }
  });

  /*
   * O 7 numa mesa de dois troca sozinho, sem perguntar. Como última carta ele
   * daria ao adversário uma mão vazia — o buraco descrito acima. Aqui se cobra
   * que a vitória venha primeiro justamente nessa mesa.
   */
  it("wins on a last seven at a table of two, instead of swapping an empty hand", () => {
    const game = newGame(2);
    game.rules.sevenSwap = true;
    setHand(game, 0, [card("s", "red", "number", 7)]);
    setHand(game, 1, [card("a", "blue", "number", 1), card("b", "blue", "number", 2)]);
    game.playCard("p0", "s");

    expect(game.phase).toBe("finished");
    expect(game.winnerId).toBe("p0");
    expect(game.players[1].hand.map((c) => c.id)).toEqual(["a", "b"]);
  });

  /*
   * A penúltima, por outro lado, é uma jogada comum: o efeito acontece. Sem
   * este par o teste acima passaria com um `playCard` que nunca aplicasse
   * efeito nenhum.
   */
  it("still swaps when the seven is not the last card", () => {
    const game = newGame(2);
    game.rules.sevenSwap = true;
    setHand(game, 0, [card("s", "red", "number", 7), card("x", "blue", "number", 3)]);
    setHand(game, 1, [card("a", "blue", "number", 1)]);
    game.playCard("p0", "s");

    expect(game.phase).toBe("playing");
    expect(game.players[0].hand.map((c) => c.id)).toEqual(["a"]);
    expect(game.players[1].hand.map((c) => c.id)).toEqual(["x"]);
  });
});

describe("two players", () => {
  it("gives the turn back after a skip", () => {
    const game = newGame(2);
    setHand(game, 0, [card("x", "red", "skip"), card("y", "red", "number", 1)]);
    game.playCard("p0", "x");
    expect(game.currentPlayer!.id).toBe("p0");
  });

  it("treats reverse as a skip", () => {
    const game = newGame(2);
    setHand(game, 0, [card("x", "red", "reverse"), card("y", "red", "number", 1)]);
    game.playCard("p0", "x");
    expect(game.currentPlayer!.id).toBe("p0");
    expect(game.direction).toBe(1);
  });

  it("returns the turn after the opponent eats a draw two", () => {
    const game = newGame(2);
    setHand(game, 0, [card("x", "red", "draw-two"), card("y", "red", "number", 1)]);
    game.playCard("p0", "x");
    game.drawCard("p1");
    expect(game.currentPlayer!.id).toBe("p0");
    expect(game.players[1].hand).toHaveLength(9);
  });
});

/**
 * Os eventos existem só para a mesa animar. O que se testa aqui é que eles
 * contam a mesma história que o estado — quem recebeu, quantas, e em que ordem.
 */
describe("fx events", () => {
  it("deals to every player and then flips the opening card", () => {
    const game = new UnoGame(seeded(7));
    game.addPlayer("p0", "kp0", "P0");
    game.addPlayer("p1", "kp1", "P1");
    game.start();

    expect(game.takeFx()).toEqual([
      { k: "deal", to: "p0", n: INITIAL_HAND_SIZE },
      { k: "deal", to: "p1", n: INITIAL_HAND_SIZE },
      { k: "flip" },
    ]);
  });

  /* O caso em que a diferença de estado mente: o tapa que fecha a rodada tira
     duas mãos da lista de uma vez, e só o evento diz qual delas bateu. */
  it("names who slapped, including on the tap that closes the round", () => {
    const game = newGame(3);
    game.rules.slapNine = true;
    setHand(game, 0, [card("nine", "red", "number", 9), filler()]);
    game.playCard("p0", "nine");
    game.takeFx();

    game.slap("p2");
    expect(game.takeFx()).toEqual([{ k: "slap", by: "p2" }]);

    // Este fecha a rodada: p1 fica devendo e compra. O tapa de p0 continua lá.
    game.slap("p0");
    expect(game.takeFx()).toEqual([
      { k: "slap", by: "p0" },
      { k: "draw", to: "p1", n: 1 },
    ]);
  });

  it("drains the queue: a second read comes back empty", () => {
    const game = newGame(3);
    expect(game.takeFx().length).toBeGreaterThan(0);
    expect(game.takeFx()).toEqual([]);
  });

  it("reports a single draw", () => {
    const game = newGame(3);
    setHand(game, 0, []);
    game.deck = [card("d", "blue", "number", 9)];
    game.takeFx();
    game.drawCard("p0");
    expect(game.takeFx()).toEqual([{ k: "draw", to: "p0", n: 1 }]);
  });

  it("reports the forced draw as one event carrying the count", () => {
    const game = newGame(3);
    setHand(game, 0, [card("x", "red", "draw-two"), filler()]);
    game.playCard("p0", "x");
    game.takeFx();
    game.drawCard("p1");
    expect(game.takeFx()).toEqual([{ k: "draw", to: "p1", n: 2 }]);
  });

  it("reports who played, so the card can leave that seat", () => {
    const game = newGame(3);
    setHand(game, 0, [card("x", "red", "number", 3), filler()]);
    game.takeFx();
    game.playCard("p0", "x");
    expect(game.takeFx()).toEqual([{ k: "play", by: "p0" }]);
  });

  it("reports the uno penalty as a draw to the player who was caught", () => {
    const { game, tick } = timedGame(3);
    setHand(game, 0, [card("x", "red", "number", 3), filler()]);
    game.playCard("p0", "x");
    tick(UNO_GRACE);
    game.takeFx();
    game.catchUno("p1", "p0");
    expect(game.takeFx()).toEqual([{ k: "draw", to: "p0", n: UNO_PENALTY }]);
  });

  it("puts the recycle before the draw it made possible", () => {
    const game = newGame(3);
    setHand(game, 0, []);
    game.deck = [];
    game.discard = [
      card("a", "blue", "number", 1),
      card("b", "green", "number", 2),
      card("top", "red", "number", 5),
    ];
    game.takeFx();
    game.drawCard("p0");
    expect(game.takeFx()).toEqual([{ k: "recycle" }, { k: "draw", to: "p0", n: 1 }]);
  });

  it("stays quiet when a rejected action changes nothing", () => {
    const game = newGame(3);
    setHand(game, 0, [card("x", "blue", "number", 3)]);
    game.takeFx();
    expect(() => game.playCard("p0", "x")).toThrow();
    expect(game.takeFx()).toEqual([]);
  });

  it("reports nothing for a draw that found no card at all", () => {
    const game = newGame(3);
    setHand(game, 0, []);
    game.deck = [];
    game.discard = [card("top", "red", "number", 5)];
    game.takeFx();
    game.drawCard("p0");
    expect(game.takeFx()).toEqual([]);
  });
});

describe("leaving", () => {
  it("ends the game when only one player is left", () => {
    const game = newGame(2);
    game.removePlayer("p1");
    expect(game.phase).toBe("finished");
    expect(game.winnerId).toBe("p0");
  });

  it("keeps the turn on the right player", () => {
    const game = newGame(3);
    game.currentIndex = 2;
    game.removePlayer("p0");
    expect(game.currentPlayer!.id).toBe("p2");
  });
});
