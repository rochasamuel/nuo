import { PLAY_COLORS, type Card, type CardType } from "@uno/shared";

const ACTIONS: CardType[] = ["skip", "reverse", "draw-two"];

/** The 108-card base deck: per color one 0, two of each 1-9 and two of each action, plus 4 wilds and 4 wild draw fours. */
export function createDeck(): Card[] {
  const cards: Card[] = [];
  const add = (card: Omit<Card, "id">) =>
    cards.push({ ...card, id: `c${cards.length}` });

  for (const color of PLAY_COLORS) {
    add({ color, type: "number", value: 0 });
    for (let value = 1; value <= 9; value++) {
      add({ color, type: "number", value });
      add({ color, type: "number", value });
    }
    for (const type of ACTIONS) {
      add({ color, type, value: null });
      add({ color, type, value: null });
    }
  }
  for (let i = 0; i < 4; i++) {
    add({ color: "wild", type: "wild", value: null });
    add({ color: "wild", type: "wild-draw-four", value: null });
  }
  return cards;
}

/** Fisher-Yates, in place. */
export function shuffle<T>(cards: T[], random: () => number): T[] {
  for (let i = cards.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
}
