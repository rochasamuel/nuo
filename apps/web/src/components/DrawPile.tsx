import { anchorRef } from "../game/flights";
import { BACK_URL } from "../lib/cards";

const DRAW_MAX = 6;

type Props = {
  remaining: number;
  disabled: boolean;
  onDraw: () => void;
};

/** Every card here is the same file, so the browser decodes `uno-back.svg` once. */
export function DrawPile({ remaining, disabled, onDraw }: Props) {
  const depth = Math.max(1, Math.min(DRAW_MAX, Math.ceil(remaining / 8)));

  return (
    <button
      type="button"
      // De onde toda carta comprada parte, e a medida de uma carta na mesa.
      ref={anchorRef("draw")}
      className="uno-stack uno-draw"
      onClick={onDraw}
      disabled={disabled}
      aria-label={`Comprar carta — ${remaining} no monte`}
    >
      {Array.from({ length: depth }, (_, index) => {
        const step = (depth - 1 - index) * 2;
        return (
          <img
            key={index}
            className="uno-card"
            src={BACK_URL}
            alt=""
            style={{ "--dx": `${-step}px`, "--dy": `${-step}px` } as React.CSSProperties}
          />
        );
      })}
    </button>
  );
}
