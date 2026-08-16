import { cardArt, type Card, type PlayColor } from "@uno/shared";

export const artUrl = (card: Pick<Card, "color" | "type" | "value">) =>
  `/cards/svg/${cardArt(card)}.svg`;

export const BACK_URL = "/cards/svg/uno-back.svg";

export const COLOR_HEX: Record<PlayColor, string> = {
  red: "var(--red)",
  yellow: "var(--yellow)",
  green: "var(--green)",
  blue: "var(--blue)",
};

function hash(n: number) {
  n = Math.imul(n ^ (n >>> 15), 0x2c1b3c6d);
  n = Math.imul(n ^ (n >>> 12), 0x297a2d39);
  return ((n ^ (n >>> 15)) >>> 0) / 2 ** 32;
}

/**
 * How messy a discarded card sits. Derived from its index in the pile, never
 * from Math.random(), which would reshuffle the whole pile on every render.
 * The spread grows with the pile so eight rendered cards look like thirty.
 */
export function scatter(index: number, pileSize: number, isTop: boolean) {
  const growth = Math.min(1, pileSize / 24);
  const spread = isTop ? 5 : 16 + 4 * growth;
  const offset = 9 + 3.5 * growth;
  return {
    rot: (hash(index * 3 + 1) * 2 - 1) * spread,
    dx: (hash(index * 3 + 2) * 2 - 1) * offset,
    dy: (hash(index * 3 + 3) * 2 - 1) * offset,
  };
}
