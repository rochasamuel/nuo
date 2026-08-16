import { useEffect, useRef, type RefObject } from "react";
import { cardLabel, type Card } from "@uno/shared";
import { anchorRef, poseOfCard, useFlightStore, type Pose } from "../game/flights";
import { artUrl } from "../lib/cards";
import { useDragCard } from "../lib/useDragCard";

const SPREAD = 6; // degrees between neighbours
const MAX_FAN = 36; // total opening; acima disso as pontas giram para fora da tela
const ARC = 10; // px the ends drop

/**
 * Quantas larguras de carta a mão ocupa, no pior caso: a caixa do leque já com
 * o recobrimento máximo de 84%, mais o balanço das cartas giradas nas pontas
 * (0,878 de largura no total, medido com a abertura travada em MAX_FAN). O CSS
 * usa o recíproco disso para saber até onde pode encolher a carta.
 */
const handSpan = (count: number) => 1.878 + 0.16 * Math.max(0, count - 1);

type Props = {
  cards: Card[];
  playableIds: Set<string>;
  yourTurn: boolean;
  dropTarget: RefObject<HTMLElement | null>;
  /** `from` é a pose em que a carta saiu da mão: de lá parte a animação. */
  onPlay: (cardId: string, from: Pose) => void;
  onDragOver: (over: boolean) => void;
};

export function Hand({
  cards: dealt,
  playableIds,
  yourTurn,
  dropTarget,
  onPlay,
  onDragOver,
}: Props) {
  /*
   * A carta que você acabou de jogar já saiu, mesmo que a mão nova ainda esteja
   * a caminho do servidor. Quem a representa daqui em diante é o voo; deixá-la
   * no leque por mais 100ms fazia ela voltar para o lugar e sair de novo.
   */
  const leaving = useFlightStore((state) => state.leaving);
  const cards = leaving ? dealt.filter((card) => card.id !== leaving) : dealt;

  /*
   * As cartas compradas entram sempre pelo fim do leque — o servidor faz
   * `hand.push` — então as que ainda estão no ar são as últimas. Elas já ocupam
   * o lugar delas, invisíveis: reservar o espaço antes é o que faz o leque
   * parar de abrir e fechar a cada compra, e é também o que dá ao voo um alvo
   * fixo para mirar.
   */
  const airborne = useFlightStore((state) => state.heldHand);
  const shown = Math.max(0, cards.length - airborne);
  const fresh = useFreshCards(cards.slice(0, shown));

  const middle = (cards.length - 1) / 2;
  const spread = Math.min(SPREAD, MAX_FAN / Math.max(1, cards.length - 1));

  return (
    <ul
      ref={anchorRef("hand")}
      className="uno-hand"
      aria-label="Sua mão"
      // O CSS aperta o leque conforme a mão cresce, para ele nunca passar da
      // largura da janela. Ver --pull em index.css.
      style={{
        "--cards": cards.length,
        "--gaps-r": 1 / Math.max(1, cards.length - 1),
        "--fit-r": 1 / handSpan(cards.length),
      } as React.CSSProperties}
    >
      {cards.map((card, index) => {
        const fromMiddle = index - middle;
        const normalized = middle === 0 ? 0 : fromMiddle / middle;
        return (
          <li
            key={card.id}
            className="uno-slot"
            style={{
              // the arc is parabolic: flat in the middle, dropping at the ends
              "--angle": `${fromMiddle * spread}deg`,
              "--drop-y": `${normalized * normalized * ARC}px`,
            } as React.CSSProperties}
          >
            <HandCard
              card={card}
              playable={playableIds.has(card.id)}
              dimmed={yourTurn && !playableIds.has(card.id)}
              isNew={fresh.has(card.id)}
              airborne={index >= shown}
              dropTarget={dropTarget}
              onPlay={onPlay}
              onDragOver={onDragOver}
            />
          </li>
        );
      })}
    </ul>
  );
}

type CardProps = {
  card: Card;
  playable: boolean;
  dimmed: boolean;
  isNew: boolean;
  /** Ainda a caminho: guarda o lugar no leque, mas não se mostra. */
  airborne: boolean;
  dropTarget: RefObject<HTMLElement | null>;
  onPlay: (cardId: string, from: Pose) => void;
  onDragOver: (over: boolean) => void;
};

function HandCard({
  card,
  playable,
  dimmed,
  isNew,
  airborne,
  dropTarget,
  onPlay,
  onDragOver,
}: CardProps) {
  const element = useRef<HTMLButtonElement>(null);

  // Clicar joga; arrastar até o descarte joga. Os dois caminhos chamam o mesmo
  // onPlay, e é o servidor que decide se a jogada vale.
  const resolve = (played: boolean, from: Pose) => {
    if (played && playable) onPlay(card.id, from);
  };

  const drag = useDragCard(dropTarget, resolve, onDragOver);
  const label = cardLabel(card);

  return (
    <button
      type="button"
      ref={element}
      className={[
        "uno-card",
        dimmed && "is-idle",
        isNew && "is-new",
        airborne && "is-airborne",
      ]
        .filter(Boolean)
        .join(" ")}
      aria-label={playable ? `Jogar ${label}` : label}
      {...drag}
      onClick={(event) => {
        // detail === 0 means keyboard: the pointer handlers never ran.
        if (event.detail === 0) resolve(true, poseOfCard(event.currentTarget));
      }}
    >
      <img src={artUrl(card)} alt="" />
    </button>
  );
}

/** Cards that were not in the hand on the previous render, so they can flip in. */
function useFreshCards(cards: Card[]) {
  const known = useRef<Set<string>>(new Set());
  const fresh = new Set(cards.filter((card) => !known.current.has(card.id)).map((c) => c.id));

  useEffect(() => {
    known.current = new Set(cards.map((card) => card.id));
  });

  return known.current.size === 0 ? new Set<string>() : fresh;
}
