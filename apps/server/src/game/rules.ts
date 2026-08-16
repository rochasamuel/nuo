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

/**
 * A única resposta possível a uma compra pendente, nas mesas que empilham: uma
 * carta do mesmo tipo da que abriu a pilha — +2 sobre +2, +4 sobre +4, nunca
 * cruzado, e a cor não importa. Quem abriu a pilha é sempre a carta do topo,
 * então não há o que guardar: com compra pendente ela é o +2/+4 mais recente.
 */
export const canStack = (card: Card, top: Card) =>
  card.type === top.type &&
  (card.type === "draw-two" || card.type === "wild-draw-four");
