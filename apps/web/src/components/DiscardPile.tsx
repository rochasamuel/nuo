import { useCallback, useEffect, useRef } from "react";
import { cardLabel, toCard, type PublicCard } from "@uno/shared";
import { anchorRef, useFlightStore } from "../game/flights";
import { artUrl, scatter } from "../lib/cards";

type Props = {
  /** The visible tail of the pile, oldest first. */
  cards: PublicCard[];
  total: number;
  armed: boolean;
  /**
   * O tapa no 9 em curso, se houver. `mine` é se VOCÊ ainda deve — quem já
   * bateu continua vendo o anel dos outros, mas não tem mais o que clicar.
   */
  slap?: { mine: boolean; onSlap: () => void };
  ref: React.RefObject<HTMLDivElement | null>;
};

export function DiscardPile({ cards, total, armed, slap, ref }: Props) {
  // A carta que ainda está voando até aqui não pode já estar na pilha.
  const airborne = useFlightStore((state) => state.heldDiscard);
  const shown = airborne.size > 0 ? cards.filter((card) => !airborne.has(card.id)) : cards;
  const top = cards.at(-1);
  const topAirborne = !top || airborne.has(top.id);

  /*
   * `seen` acompanha o total REAL, não o que está visível. É o que faz o
   * `is-dealt` — a queda de 46px que a carta dá ao entrar na pilha — valer só
   * para quem chegou sem voar: movimento reduzido, âncora ausente, ou entrar
   * numa partida já em andamento. Quem veio voando já pousou na pose final, e
   * uma segunda queda por cima disso é o salto que se quer evitar.
   */
  const seen = useRef(total);
  const base = total - cards.length;

  useEffect(() => {
    seen.current = total;
  }, [total]);

  // Um elemento, dois papéis: alvo do arrasto (o Table precisa medi-lo) e
  // âncora dos voos. Cada um quer a sua própria ref.
  const attach = useCallback(
    (element: HTMLDivElement | null) => {
      ref.current = element;
      anchorRef("discard")(element);
    },
    [ref],
  );

  return (
    <div
      ref={attach}
      className={`uno-stack uno-discard uno-drop-zone ${armed ? "is-armed" : ""}`}
    >
      {shown.map((card, offset) => {
        // The key is the index in the WHOLE pile. With the index inside the
        // visible slice, every play slides the window and React recycles the
        // wrong nodes — cards swap places on their own.
        const index = base + offset;
        // Quem é o topo se decide pela pilha inteira, não pelo que está
        // visível: com a carta de cima ainda no ar, a de baixo viraria "topo",
        // trocaria de espalhamento e voltaria atrás quando a outra pousasse.
        const isTop = index === total - 1;
        const { rot, dx, dy } = scatter(index, total, isTop);
        return (
          <img
            key={index}
            className={`uno-card ${index >= seen.current ? "is-dealt" : ""}`}
            src={artUrl(toCard(card))}
            alt={isTop ? cardLabel(toCard(card)) : ""}
            style={{
              "--rot": `${rot}deg`,
              "--dx": `${dx}%`,
              "--dy": `${dy}%`,
              // A carta de cima passa na frente do anel do tapa; as de baixo
              // ficam atrás dele. É o que faz o anel emoldurar só o 9 em vez de
              // aparecer em retalhos entre as cartas espalhadas da pilha.
              zIndex: isTop ? 2 : undefined,
            } as React.CSSProperties}
          />
        );
      })}

      {/* O anel só nasce com o 9 já pousado: anunciar o tapa numa carta que
          ainda está no ar seria pedir para bater no vazio. */}
      {slap && !topAirborne && <SlapRing total={total} />}

      {slap?.mine && (
        <button
          type="button"
          className="uno-slap-hit"
          onClick={slap.onSlap}
          aria-label="Bater no 9"
        />
      )}
    </div>
  );
}

/** O anel pulsante, na pose exata da carta de cima. */
function SlapRing({ total }: { total: number }) {
  const { rot, dx, dy } = scatter(total - 1, total, true);
  return (
    <span
      aria-hidden
      className="uno-slap-ring"
      style={{
        "--rot": `${rot}deg`,
        "--dx": `${dx}%`,
        "--dy": `${dy}%`,
      } as React.CSSProperties}
    />
  );
}
