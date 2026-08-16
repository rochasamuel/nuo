import { isWild, type Card, type PlayColor } from "@uno/shared";

/**
 * A card is playable when it is a wild, when it matches the color in play, or
 * when it matches the face of the top card. `currentColor` — not `top.color` —
 * is the authority, because a wild on top carries the color its owner chose.
 */
export function canPlay(
  card: Card,
  top: Card,
  currentColor: PlayColor,
): boolean {
  if (isWild(card)) return true;
  if (card.color === currentColor) return true;
  if (card.type === "number") {
    return top.type === "number" && card.value === top.value;
  }
  return card.type === top.type;
}
