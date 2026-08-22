import { useCallback, useMemo, useRef, useState } from "react";
import {
  PLAY_COLORS,
  STARTER_SPIN,
  type Card,
  type CardType,
  type EmoteEvent,
  type PlayColor,
  type PublicCard,
  type PublicPlayer,
  type TableState,
} from "@uno/shared";
import { FlightLayer } from "../components/FlightLayer";
import { StarterRoulette } from "../components/StarterRoulette";
import { Table } from "../components/Table";
import { flyDeal, flyDraw, flyRotate, flySwap } from "../game/flights";
import { useMediaQuery } from "../lib/useMediaQuery";
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
  /*
   * Aberta onde ela cabe ao lado da mesa, fechada onde ela cobriria a mesa —
   * mas só até alguém decidir. `null` é "ainda não decidiram", e é o que deixa
   * o padrão seguir a largura da janela sem passar por cima de uma escolha.
   */
  const wideEnough = useMediaQuery("(min-width: 640px)");
  const [panelOpen, setPanelOpen] = useState<boolean | null>(null);
  const showPanel = panelOpen ?? wideEnough;

  const [handSize, setHandSize] = useState(25);
  const [playerCount, setPlayerCount] = useState(10);
  const [wildOnTop, setWildOnTop] = useState(true);
  const [finished, setFinished] = useState(false);
  const [pendingDraw, setPendingDraw] = useState(0);
  const [stacking, setStacking] = useState(true);
  const [drawUntilPlayable, setDrawUntilPlayable] = useState(false);
  const [slapNine, setSlapNine] = useState(true);
  const [sevenSwap, setSevenSwap] = useState(true);
  const [zeroRotate, setZeroRotate] = useState(true);
  /** Quem ainda deve o tapa. Vazio é o caso normal. */
  const [slapPending, setSlapPending] = useState<string[]>([]);
  /** Quem deve escolher a troca no 7. Vazio é o caso normal. */
  const [swapChooserId, setSwapChooserId] = useState("");
  const [catchOpen, setCatchOpen] = useState(true);
  const [mustPlayDrawn, setMustPlayDrawn] = useState(false);
  const [nudge, setNudge] = useState(0);
  /** Cartas já jogadas nesta mão: sai a que se clicou, não a última. */
  const [played, setPlayed] = useState<string[]>([]);
  /** A volta da roleta em exibição, se houver uma. */
  const [draft, setDraft] = useState<{ round: number; winnerId: string } | null>(null);

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
      rules: { stacking, drawUntilPlayable, slapNine, sevenSwap, zeroRotate },
      players,
      currentPlayerId: ME,
      // Sem sorteio em curso: em /mock a roleta é um botão da barra lateral.
      starterId: "",
      currentColor: "green" as PlayColor,
      direction: -1,
      pendingDraw,
      deckCount: 34,
      discardCount: 26,
      discard,
      winnerId: finished ? "p2" : "",
      vulnerablePlayerIds: ["p1"],
      catchOpen,
      mustPlayDrawn,
      slapPending,
      swapChooserId,
      log: [
        "A partida começou com 2 azul.",
        "Ana Beatriz jogou bloqueio azul.",
        "Bruno comprou 3 até achar uma jogável.",
        "Bruno passou a vez.",
        "Caio jogou coringa troca cor e escolheu verde.",
        "Dandara gritou UNO!",
        "A compra acabou: o descarte foi reembaralhado.",
      ],
    };
  }, [
    catchOpen,
    drawUntilPlayable,
    finished,
    hand.length,
    mustPlayDrawn,
    pendingDraw,
    playerCount,
    sevenSwap,
    slapNine,
    slapPending,
    stacking,
    swapChooserId,
    wildOnTop,
    zeroRotate,
  ]);

  // Metade das cartas jogáveis, para ver as duas aparências no mesmo leque —
  // e nenhuma com o tapa aberto, que é o que o servidor responde numa mesa
  // congelada.
  const playableIds = useMemo(
    () =>
      slapPending.length > 0 || swapChooserId !== ""
        ? new Set<string>()
        : new Set(hand.filter((_, i) => i % 2 === 0).map((card) => card.id)),
    [hand, slapPending, swapChooserId],
  );

  /*
   * Sem sala, a conversa é um eco local: o emoji que você manda volta como se o
   * servidor o tivesse anunciado. É o que permite rever o balão aqui, com a
   * mesma `Table` e o mesmo `useEmotes` da mesa de verdade.
   */
  const emoteHandlers = useRef(new Set<(event: EmoteEvent) => void>());
  const onEmote = useCallback((handler: (event: EmoteEvent) => void) => {
    const handlers = emoteHandlers.current;
    handlers.add(handler);
    return () => handlers.delete(handler);
  }, []);

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
    play: (cardId) => {
      setPlayed((ids) => [...ids, cardId]);
      // O empilhamento é a única regra com número na tela: aqui a pilha cresce
      // a cada +2/+4 baixado, que é o que faz o contador da lateral aparecer.
      const chosen = hand.find((card) => card.id === cardId);
      const stacked = chosen?.type === "draw-two" ? 2 : chosen?.type === "wild-draw-four" ? 4 : 0;
      if (stacking && stacked) setPendingDraw((n) => n + stacked);
    },
    draw: () => {
      // Sem pilha pendente é uma carta — ou a corrida da regra de comprar até
      // achar, que aqui para sempre na terceira só para se ver o voo em fila.
      const count = pendingDraw || (drawUntilPlayable ? 3 : 1);
      flyDraw({ toSeat: null, count });
      setHandSize((size) => size + count);
      setPendingDraw(0);
    },
    pass: () => setMustPlayDrawn(false),
    callUno: () => {},
    catchUno: (targetId) => flyDraw({ toSeat: targetId, count: 2 }),
    // Bater tira você da lista. Sobrando um, ele compra — a mesma resolução do
    // servidor, para dar de ver aqui a rodada inteira e não só o anel.
    slap: () =>
      setSlapPending((pending) => {
        const left = pending.filter((id) => id !== ME);
        if (left.length > 1) return left;
        if (left.length === 1) flyDraw({ toSeat: left[0], count: 1 });
        return [];
      }),
    // Escolher fecha a troca e manda as duas mãos atravessarem a mesa. A mão de
    // mentira não muda de dono: o que se revisa aqui é a travessia.
    swap: (targetId) => {
      setSwapChooserId("");
      flySwap(null, targetId);
    },
    emote: (emote) => {
      for (const handler of emoteHandlers.current) handler({ by: ME, emote });
    },
    restart: () => setFinished(false),
  };

  /*
   * A roleta do sorteio, que na mesa de verdade roda uma vez por partida e some.
   * Aqui ela é um botão, e cada volta tira um nome diferente — o `round` é o que
   * a remonta, senão o segundo clique cairia numa roleta já parada.
   */
  const spin = () => {
    const winner = state.players[Math.floor(Math.random() * state.players.length)];
    const round = (draft?.round ?? 0) + 1;
    setDraft({ round, winnerId: winner.id });
    setTimeout(
      () => setDraft((current) => (current?.round === round ? null : current)),
      STARTER_SPIN,
    );
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
        onEmote={onEmote}
        onExit={() => setFinished(false)}
      />

      {/*
        A barra cresce a cada regra nova e já passa da dobra num notebook: daí a
        altura presa à janela e a rolagem própria. `top-16` mais a folga de
        baixo são as 5rem que saem do cálculo. `overscroll-contain` para que
        chegar ao fim da lista não puxe a página atrás — que é a mesa.

        E ela se recolhe: num celular a barra cobre a mesa inteira, que é
        justamente o que se veio olhar. O botão fica no canto em que ela abre,
        e continua na tela quando ela sai — senão não haveria como trazê-la de
        volta.
      */}
      <div className="fixed top-16 right-4 z-30 flex max-h-[calc(100dvh-5rem)] w-56 max-w-[calc(100vw-2rem)] flex-col items-end gap-2">
        <button
          type="button"
          className="px-btn shrink-0"
          onClick={() => setPanelOpen(!showPanel)}
          aria-expanded={showPanel}
        >
          {showPanel ? "esconder ▸" : "▤ mock"}
        </button>

        {showPanel && (
        <div className="px-slab uno-mock-panel flex w-full min-h-0 flex-col gap-3 overflow-y-auto overscroll-contain p-3">

        <Slider label="Cartas na mão" value={handSize} min={1} max={30} onChange={dealHand} />
        <Slider label="Jogadores" value={playerCount} min={2} max={10} onChange={setPlayerCount} />
        <Slider label="Compra pendente" value={pendingDraw} min={0} max={12} onChange={setPendingDraw} />

        <Toggle label="Empilhar +2/+4" on={stacking} onClick={() => setStacking((v) => !v)} />
        <Toggle
          label="Comprar até achar"
          on={drawUntilPlayable}
          onClick={() => setDrawUntilPlayable((v) => !v)}
        />
        <Toggle label="Tapa no 9" on={slapNine} onClick={() => setSlapNine((v) => !v)} />
        <Toggle label="Troca no 7" on={sevenSwap} onClick={() => setSevenSwap((v) => !v)} />
        <Toggle label="Roda no 0" on={zeroRotate} onClick={() => setZeroRotate((v) => !v)} />
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
        <button type="button" className="px-btn" onClick={spin}>
          Sortear quem começa
        </button>
        <button
          type="button"
          className="px-btn"
          onClick={() => setSlapPending(state.players.map((player) => player.id))}
        >
          Abrir tapa no 9
        </button>
        <button
          type="button"
          className="px-btn"
          onClick={() => setSwapChooserId(ME)}
        >
          Trocar no 7 · você escolhe
        </button>
        <button
          type="button"
          className="px-btn"
          onClick={() => setSwapChooserId(state.players[1].id)}
        >
          Trocar no 7 · outro escolhe
        </button>
        {/* A travessia entre dois adversários, que é o caso que a mesa mais vê
            e o único que não dá para disparar clicando num assento. */}
        <button
          type="button"
          className="px-btn"
          onClick={() => flySwap(state.players[1].id, state.players[2].id)}
        >
          Trocar no 7 · entre outros
        </button>
        {/* A roda inteira, na direção que a mesa está correndo — é o único jeito
            de rever a volta sem esperar um 0 cair numa partida de verdade. */}
        <button
          type="button"
          className="px-btn"
          onClick={() => {
            const seats = state.players.map((player) =>
              player.id === ME ? null : player.id,
            );
            flyRotate(state.direction === 1 ? seats : [seats[0], ...seats.slice(1).reverse()]);
          }}
        >
          Rodar no 0
        </button>
        <p className="px-label">
          Clique numa carta para jogar; no monte para comprar. A compra pendente
          define quantas cartas voam de uma vez. Com o empilhamento ligado, cada
          +2/+4 jogado soma à pilha e o contador da lateral acompanha.
        </p>
        </div>
        )}
      </div>

      {draft && (
        <StarterRoulette
          key={draft.round}
          players={state.players}
          winnerId={draft.winnerId}
        />
      )}

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
