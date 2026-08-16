import { useMemo, useState } from "react";
import {
  PLAY_COLORS,
  type Card,
  type CardType,
  type PlayColor,
  type PublicCard,
  type PublicPlayer,
  type TableState,
} from "@uno/shared";
import { FlightLayer } from "../components/FlightLayer";
import { Table } from "../components/Table";
import { flyDeal, flyDraw } from "../game/flights";
import type { RoomActions } from "../game/useRoomConnection";

/**
 * Mesa de mentira para acertar o layout sem precisar de servidor nem de outros
 * jogadores: 25 cartas na mão, 10 lugares ocupados, pilha grande, coringa no
 * topo. Fica em /mock e não toca em nada do jogo — o `Table` é o mesmo.
 */

const ME = "me";
const NAMES = [
  "Samuel", "Mikhael", "Ana Beatriz", "Bruno", "Caio",
  "Dandara", "Eduardo", "Fernanda", "Gustavo", "Helena",
];

const TYPES: CardType[] = ["number", "number", "number", "skip", "reverse", "draw-two"];

/** Baralho de mentira, mas determinístico: o mesmo mock em todo carregamento. */
function fakeCard(seed: number): Card {
  if (seed % 11 === 7) return { id: `m${seed}`, color: "wild", type: "wild", value: null };
  if (seed % 17 === 5) {
    return { id: `m${seed}`, color: "wild", type: "wild-draw-four", value: null };
  }
  const color = PLAY_COLORS[seed % 4];
  const type = TYPES[seed % TYPES.length];
  return {
    id: `m${seed}`,
    color,
    type,
    value: type === "number" ? seed % 10 : null,
  };
}

const toPublic = (card: Card): PublicCard => ({
  id: card.id,
  color: card.color,
  kind: card.type,
  value: card.value ?? -1,
});

export function MockScreen() {
  const [handSize, setHandSize] = useState(25);
  const [playerCount, setPlayerCount] = useState(10);
  const [wildOnTop, setWildOnTop] = useState(true);
  const [finished, setFinished] = useState(false);
  const [pendingDraw, setPendingDraw] = useState(0);
  const [catchOpen, setCatchOpen] = useState(true);
  const [mustPlayDrawn, setMustPlayDrawn] = useState(false);
  const [nudge, setNudge] = useState(0);
  /** Cartas já jogadas nesta mão: sai a que se clicou, não a última. */
  const [played, setPlayed] = useState<string[]>([]);

  const hand = useMemo(
    () =>
      Array.from({ length: handSize }, (_, i) => fakeCard(i + nudge * 100)).filter(
        (card) => !played.includes(card.id),
      ),
    [handSize, nudge, played],
  );

  /** Trocar o tamanho da mão reparte de novo — o que já saiu volta. */
  const dealHand = (size: number) => {
    setHandSize(size);
    setPlayed([]);
  };

  const state = useMemo<TableState>(() => {
    const players: PublicPlayer[] = Array.from({ length: playerCount }, (_, i) => ({
      id: i === 0 ? ME : `p${i}`,
      name: NAMES[i % NAMES.length],
      cardCount: i === 0 ? hand.length : [7, 1, 12, 3, 25, 2, 9, 4, 6, 1][i % 10],
      connected: i !== 3,
      // Só quem tem 1 carta mostra o estado. p1 esqueceu de gritar (fica
      // pegável); p9 gritou (fica seguro). São os dois únicos com 1 carta.
      calledUno: i === 9,
    }));

    const discard: PublicCard[] = Array.from({ length: 8 }, (_, i) =>
      toPublic(fakeCard(i + 40)),
    );
    if (wildOnTop) {
      discard[7] = { id: "top", color: "wild", kind: "wild", value: -1 };
    }

    return {
      roomName: "Sexta-feira UNO",
      hostId: ME,
      phase: finished ? "finished" : "playing",
      maxPlayers: 10,
      players,
      currentPlayerId: ME,
      currentColor: "green" as PlayColor,
      direction: -1,
      pendingDraw,
      deckCount: 34,
      discardCount: 26,
      discard,
      winnerId: finished ? "p2" : "",
      vulnerablePlayerId: "p1",
      catchOpen,
      mustPlayDrawn,
      log: [
        "A partida começou com 2 azul.",
        "Ana Beatriz jogou bloqueio azul.",
        "Bruno comprou uma carta.",
        "Caio jogou coringa troca cor.",
        "Dandara gritou UNO!",
        "A compra acabou: o descarte foi reembaralhado.",
      ],
    };
  }, [catchOpen, finished, hand.length, mustPlayDrawn, pendingDraw, playerCount, wildOnTop]);

  // Metade das cartas jogáveis, para ver as duas aparências no mesmo leque.
  const playableIds = useMemo(
    () => new Set(hand.filter((_, i) => i % 2 === 0).map((card) => card.id)),
    [hand],
  );

  /*
   * Sem servidor não há eventos `fx`, então aqui os voos são disparados à mão.
   * É o mesmo `flights.ts` do jogo — o que se vê em /mock é o que se vê na
   * mesa de verdade, e é o único jeito de revisar a animação sem abrir dois
   * navegadores e arranjar um segundo jogador.
   */
  const actions: RoomActions = {
    start: () => {},
    // A jogada já sai voando pela própria Table, que é quem conhece a carta e o
    // ponto de onde ela partiu. Aqui só falta tirá-la da mão.
    play: (cardId) => setPlayed((ids) => [...ids, cardId]),
    draw: () => {
      const count = Math.max(1, pendingDraw);
      flyDraw({ toSeat: null, count });
      setHandSize((size) => size + count);
    },
    pass: () => setMustPlayDrawn(false),
    callUno: () => {},
    catchUno: (targetId) => flyDraw({ toSeat: targetId, count: 2 }),
    restart: () => setFinished(false),
  };

  /** O reparto inicial inteiro, que de outro jeito só aparece uma vez por partida. */
  const deal = () =>
    flyDeal(
      state.players.map((player) => ({
        seat: player.id === ME ? null : player.id,
        count: 7,
      })),
    );

  return (
    <>
      <Table
        state={state}
        sessionId={ME}
        hand={hand}
        playableIds={playableIds}
        actions={actions}
      />

      <div className="px-slab fixed top-16 right-4 z-30 flex w-56 flex-col gap-3 p-3">
        <p className="px-label">Mock</p>

        <Slider label="Cartas na mão" value={handSize} min={1} max={30} onChange={dealHand} />
        <Slider label="Jogadores" value={playerCount} min={2} max={10} onChange={setPlayerCount} />
        <Slider label="Compra pendente" value={pendingDraw} min={0} max={4} onChange={setPendingDraw} />

        <Toggle label="Coringa no topo" on={wildOnTop} onClick={() => setWildOnTop((v) => !v)} />
        <Toggle label="Pegar liberado" on={catchOpen} onClick={() => setCatchOpen((v) => !v)} />
        <Toggle label="Comprou, pode passar" on={mustPlayDrawn} onClick={() => setMustPlayDrawn((v) => !v)} />
        <Toggle label="Fim de partida" on={finished} onClick={() => setFinished((v) => !v)} />

        <button
          type="button"
          className="px-btn"
          onClick={() => {
            setNudge((n) => n + 1);
            setPlayed([]);
          }}
        >
          Outra mão
        </button>
        <button type="button" className="px-btn" onClick={deal}>
          Repartir
        </button>
        <p className="px-label">
          Clique numa carta para jogar; no monte para comprar. A compra pendente
          define quantas cartas voam de uma vez.
        </p>
      </div>

      <FlightLayer />
    </>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="px-label">
        {label} · {value}
      </span>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        style={{ accentColor: "var(--mark)" }}
      />
    </label>
  );
}

function Toggle({ label, on, onClick }: { label: string; on: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="px-btn flex items-center gap-2 text-left"
      aria-pressed={on}
    >
      <span
        className="inline-block size-3 shrink-0"
        style={{
          background: on ? "var(--mark)" : "var(--slab-sh)",
          border: "2px solid var(--rim)",
        }}
      />
      {label}
    </button>
  );
}
