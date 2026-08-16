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
  for (let i = 0; i < playerCount; i++) game.addPlayer(`p${i}`, `P${i}`);
  return game;
}

/** A started game normalized to a neutral position: red 5 on top, first player to act. */
function newGame(playerCount = 3) {
  const game = new UnoGame(seeded(7));
  for (let i = 0; i < playerCount; i++) game.addPlayer(`p${i}`, `P${i}`);
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
  for (let i = 0; i < playerCount; i++) game.addPlayer(`p${i}`, `P${i}`);
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
      game.addPlayer("a", "A");
      game.addPlayer("b", "B");
      game.start();
      expect(game.players.every((p) => p.hand.length === 7)).toBe(true);
      expect(game.topCard!.color).not.toBe("wild");
      expect(game.deck.length + game.discard.length + 14).toBe(108);
    }
  });

  it("refuses to start with a single player", () => {
    const game = new UnoGame(seeded(1));
    game.addPlayer("a", "A");
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
    expect(game.vulnerableId).toBe("p0");

    tick(UNO_GRACE);
    game.catchUno("p1", "p0");
    expect(game.players[0].hand).toHaveLength(3);
    expect(game.vulnerableId).toBe("");
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
    expect(game.vulnerableId).toBe("p0");

    game.callUno("p0");
    expect(game.vulnerableId).toBe("");
    expect(() => game.catchUno("p1", "p0")).toThrow(/ninguém para pegar/);
  });

  it("refuses the call before the last card, so it cannot be armed in advance", () => {
    const game = newGame(3);
    setHand(game, 0, [card("x", "red", "number", 3), card("y", "blue", "number", 4)]);
    expect(() => game.callUno("p0")).toThrow(/assim que ficar com uma carta/);

    game.playCard("p0", "x");
    expect(game.vulnerableId).toBe("p0"); // sem o atalho, ele fica exposto
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
    game.addPlayer("p0", "P0");
    game.addPlayer("p1", "P1");
    game.start();

    expect(game.takeFx()).toEqual([
      { k: "deal", to: "p0", n: INITIAL_HAND_SIZE },
      { k: "deal", to: "p1", n: INITIAL_HAND_SIZE },
      { k: "flip" },
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
