import { Fragment, useEffect, useLayoutEffect, useRef, useState } from "react";
import { COLOR_NAME, isWild, type Card, type PlayColor, type TableState } from "@uno/shared";
import type { RoomActions, RoomConnection } from "../game/useRoomConnection";
import { flyPlay, handCardPose, markLeaving, type Pose } from "../game/flights";
import { useEmotes } from "../game/useEmotes";
import { artUrl, COLOR_HEX, scatter } from "../lib/cards";
import { useSound } from "../lib/sound";
import { useUi } from "../store/ui";
import { DiscardPile } from "./DiscardPile";
import { DrawPile } from "./DrawPile";
import { EmoteBubble } from "./EmoteBubble";
import { EmotePicker } from "./EmotePicker";
import { Hand } from "./Hand";
import { PlayerSeat } from "./PlayerSeat";
import { RulesMenu } from "./RulesMenu";
import { StackCounter } from "./StackCounter";
import { SystemLog } from "./SystemLog";
import { WildPicker } from "./WildPicker";

type Props = {
  state: TableState;
  sessionId: string;
  hand: Card[];
  playableIds: Set<string>;
  actions: RoomActions;
  /**
   * Os eventos da sala, para o som do tapa dos outros. Opcional porque a mesa
   * de mentira do /mock não tem sala atrás dela.
   */
  onFx?: RoomConnection["onFx"];
  /** A conversa da mesa. Opcional pelo mesmo motivo que `onFx`. */
  onEmote?: RoomConnection["onEmote"];
  /** Deixa a mesa e volta para a tela inicial. */
  onExit: () => void;
};

export function Table({
  state,
  sessionId,
  hand,
  playableIds,
  actions,
  onFx,
  onEmote,
  onExit,
}: Props) {
  const discardRef = useRef<HTMLDivElement>(null);
  const [dropArmed, setDropArmed] = useState(false);
  const [pendingWild, setPendingWild] = useState<string | null>(null);
  const soundEnabled = useUi((ui) => ui.soundEnabled);
  const toggleSound = useUi((ui) => ui.toggleSound);

  const playSound = useSound();
  useTableSounds(state, sessionId, hand.length);
  useSlapSound(sessionId, onFx);
  const bubbles = useEmotes(onEmote);

  /*
   * O seu tapa soa no clique, sem esperar o servidor confirmar — a mesma
   * escolha da carta que parte da mão. Aqui ela pesa mais: o tapa é uma
   * corrida de reflexo, e cem milissegundos de ida e volta transformam o som
   * de resposta em eco. O dos outros vem pelo estado, em `useTableSounds`.
   */
  const tap = () => {
    playSound("slap");
    actions.slap();
  };

  const yourTurn = state.currentPlayerId === sessionId && state.phase === "playing";
  const seats = seatOrder(state, sessionId);
  const [seatRow, lineStarts] = useLineStarts(seats.length);
  const current = state.players.find((player) => player.id === state.currentPlayerId);
  const me = state.players.find((player) => player.id === sessionId);
  const canCallUno = state.phase === "playing" && hand.length === 1 && !me?.calledUno;

  /*
   * A mesa parada pela troca no 7. Ao contrário do tapa, aqui age uma pessoa só
   * e o resto espera — então há duas telas: a de quem escolhe, com todos os
   * assentos virados em alvo, e a de quem assiste, que só precisa saber por
   * quem a mesa parou.
   */
  const swapping = state.swapChooserId !== "";
  const iSwap = state.swapChooserId === sessionId;
  const chooser = state.players.find((player) => player.id === state.swapChooserId);

  // A mesa congelada pelo tapa: ninguém joga, todo mundo bate. `mine` é se você
  // ainda deve o seu — quem já bateu só assiste os outros correrem.
  const slapping = state.slapPending.length > 0;
  const slap = slapping
    ? { mine: state.slapPending.includes(sessionId), onSlap: tap }
    : undefined;

  /*
   * A sua carta parte no clique, sem esperar o servidor confirmar. Ela é a
   * única que o cliente conhece antes da resposta — e é justamente a que não
   * pode esperar: os 100ms da ida e volta são o tempo de ela voltar para o
   * leque e sair de novo. Se a jogada for recusada, a carta reaparece na mão.
   *
   * O destino é a pose EXATA que ela terá na pilha, com o mesmo espalhamento
   * que o DiscardPile vai calcular. Voar até o centro e espalhar depois custa
   * um pulo de uns quinze pixels no quadro seguinte ao pouso.
   */
  const launch = (card: Card, from: Pose) => {
    const total = state.discardCount + 1;
    const { rot, dx, dy } = scatter(total - 1, total, true);
    flyPlay({ kind: "me", from }, { id: card.id, art: artUrl(card) }, { rot, dx, dy });
    markLeaving(card.id);
  };

  const play = (cardId: string, from: Pose) => {
    const card = hand.find((item) => item.id === cardId);
    if (!card) return;
    // O coringa não sai da mão enquanto a cor não for escolhida: quem parte é
    // o seletor, e a carta só voa quando a jogada de fato é enviada.
    if (isWild(card)) return setPendingWild(cardId);
    actions.play(cardId);
    launch(card, from);
  };

  const pickColor = (color: PlayColor) => {
    const index = hand.findIndex((item) => item.id === pendingWild);
    const card = hand[index];
    const from = index === -1 ? null : handCardPose(index);
    if (card) actions.play(card.id, color);
    if (card && from) launch(card, from);
    setPendingWild(null);
  };

  return (
    <div className="uno-table flex min-h-dvh flex-col gap-3 p-4">
      {/* `relative` pelo painel do RulesMenu, que pende desta barra e não do
          próprio botão — ver .uno-rules-panel em index.css. */}
      <header className="px-slab relative flex flex-wrap items-center justify-between gap-3 px-4 py-2">
        <span className="flex items-baseline gap-2">
          <span className="px-label">{state.roomName}</span>
          <span className="text-sm" style={{ color: "var(--paper-hi)" }}>
            vez de <b style={{ color: "var(--mark)" }}>{current?.name ?? "—"}</b>
          </span>
        </span>

        <span className="flex items-center gap-4">
          {state.currentColor && (
            <span className="flex items-center gap-2">
              <span
                className="inline-block size-4"
                style={{
                  background: COLOR_HEX[state.currentColor],
                  border: "2px solid var(--rim)",
                }}
              />
              <span className="px-label">{COLOR_NAME[state.currentColor]}</span>
            </span>
          )}
          <span className="px-label" title="direção">
            {state.direction === 1 ? "↻ horário" : "↺ anti-horário"}
          </span>
          <RulesMenu rules={state.rules} />
          <button
            type="button"
            onClick={toggleSound}
            className="px-link"
            aria-label={soundEnabled ? "Desligar o som" : "Ligar o som"}
          >
            {soundEnabled ? "🔊" : "🔇"}
          </button>
        </span>
      </header>

      {/*
        A fileira é sempre a ordem do array de jogadores começando depois de
        você — o que muda com o inverter não é a ordem dos assentos, é para que
        lado a vez corre por eles. Daí a setinha entre um assento e o outro: ela
        aponta para quem joga depois. Quem quer a palavra lê "horário" no
        cabeçalho, quem só quer saber de quem é a vez seguinte segue a seta.

        No celular ela não aparece: ali os assentos já quebram em várias
        fileiras, e uma seta a cada par cobra a largura de que o nome precisa
        para não ser cortado. O cabeçalho continua dizendo o sentido por
        extenso.
      */}
      {/* A folga entre fileiras encolhe no celular; a horizontal não: são os
          16px de que o ▶ da vez precisa à esquerda do assento. */}
      <section
        ref={seatRow}
        className="flex flex-wrap items-start justify-center gap-x-4 gap-y-2 sm:gap-y-4"
      >
        {seats.map((player, index) => (
          <Fragment key={player.id}>
            {index > 0 && (
              <span
                className={`uno-flow hidden sm:block ${
                  lineStarts.includes(index) ? "uno-flow-wrapped" : ""
                }`}
                aria-hidden="true"
              >
                {state.direction === 1 ? "→" : "←"}
              </span>
            )}
            <PlayerSeat
              player={player}
              active={player.id === state.currentPlayerId}
              isHost={player.id === state.hostId}
              catchable={
                state.catchOpen &&
                state.vulnerablePlayerIds.includes(player.id) &&
                player.id !== sessionId
              }
              onCatch={() => actions.catchUno(player.id)}
              // Todo assento na tela é um alvo válido: você não tem assento, e
              // qualquer outro serve. Não há alvo errado para desabilitar.
              pickable={iSwap}
              onPick={() => actions.swap(player.id)}
              choosing={player.id === state.swapChooserId}
              bubble={bubbles[player.id]}
            />
          </Fragment>
        ))}
      </section>

      {/* A mesa: o que está em jogo, e de todo mundo. */}
      <section className="relative flex flex-1 items-center justify-center gap-12 sm:gap-20">
        {state.rules.stacking && state.pendingDraw > 0 && (
          <StackCounter
            key={state.pendingDraw}
            amount={state.pendingDraw}
            owner={current?.name ?? ""}
          />
        )}
        <DrawPile
          remaining={state.deckCount}
          // Só se compra sem jogada possível — mas pagar a pilha é sempre uma
          // saída, mesmo com um +2 na mão para empilhar. Com o tapa aberto a
          // mesa está congelada e nem isso vale.
          disabled={
            slapping ||
            swapping ||
            !yourTurn ||
            (state.pendingDraw === 0 && playableIds.size > 0)
          }
          onDraw={actions.draw}
        />
        <DiscardPile
          ref={discardRef}
          cards={state.discard}
          total={state.discardCount}
          armed={dropArmed}
          slap={slap}
        />
      </section>

      {/*
        O seu lado: as ações são sobre a sua mão, não sobre as pilhas, então
        moram junto do leque. As duas seções são `flex-1`, então a folga de uma
        tela alta se divide entre a mesa e você em vez de empoçar num lugar só.
        O log flutua por cima do canto: uma coluna fixa empurraria o leque e a
        página ganharia rolagem.
      */}
      {/*
        O gap-8 abaixo das ações são os mesmos 32px que a carta sobe no hover,
        então uma carta levantada encosta nos botões em vez de cobri-los.

        Sem `flex-1` aqui: toda a folga vai para a mesa, que centra as pilhas, e
        o seu lado fica a uma distância fixa da borda de baixo. Centrar este
        bloco faria a folga sob a mão crescer com a altura da janela — 322px de
        feltro vazio num monitor de 1920.
      */}
      <div className="relative mt-3 flex flex-col items-center gap-8 pb-8">
        <div className="absolute bottom-0 left-0 hidden md:block">
          <SystemLog messages={state.log} />
        </div>

        <div className="relative flex min-h-9 flex-wrap items-center justify-center gap-3">
          {/* O seu balão nasce aqui porque você não tem assento: a fileira de
              ações é o seu lugar na mesa, e o balão pende dela para cima como o
              dos outros pende do assento deles. Absoluto pelo mesmo motivo —
              nada se move quando ele vai e vem. */}
          {bubbles[sessionId] && (
            <span className="absolute bottom-full left-1/2 z-20 -translate-x-1/2 pb-1">
              <EmoteBubble
                key={bubbles[sessionId].seq}
                emote={bubbles[sessionId].emote}
              />
            </span>
          )}

          {slapping && (
            <span className="px-label" style={{ color: "var(--mark)" }}>
              {slap?.mine ? "Tapa no 9! Bata na carta · " : "Tapa no 9 · "}
              faltam {state.slapPending.length}
            </span>
          )}
          {/* O aviso mora aqui, onde já moram os outros: é desta fileira que se
              lê o que a mesa está esperando. Quem escolhe também precisa dele —
              os assentos piscam lá em cima, mas quem acabou de baixar uma carta
              está olhando para a própria mão. */}
          {swapping && (
            <span className="px-label" style={{ color: "var(--mark)" }}>
              {iSwap
                ? "Troca no 7! Escolha um jogador ▲"
                : `Troca no 7 · ${chooser?.name ?? "alguém"} está escolhendo`}
            </span>
          )}
          {state.pendingDraw > 0 && yourTurn && (
            <span className="px-label" style={{ color: "var(--mark)" }}>
              {/* Só há carta jogável com a pilha de pé numa mesa que empilha, e
                  aí comprar deixa de ser a única saída. */}
              {playableIds.size > 0
                ? `Empilhe ou compre ${state.pendingDraw}`
                : `Compre ${state.pendingDraw} cartas`}
            </span>
          )}
          {/* Comprando até achar não há o que decidir: a carta que a busca
              trouxe tem que ser baixada, então o botão dá lugar ao aviso. */}
          {state.mustPlayDrawn && yourTurn && (
            state.rules.drawUntilPlayable ? (
              <span className="px-label" style={{ color: "var(--mark)" }}>
                Baixe a carta que você comprou
              </span>
            ) : (
              <button type="button" onClick={actions.pass} className="px-btn">
                Passar a vez
              </button>
            )
          )}
          {/* Só acende na janela em que vale — o botão desabilitado é o que
              impede o clique adiantado, e o servidor recusa de qualquer jeito. */}
          <button
            type="button"
            onClick={actions.callUno}
            disabled={!canCallUno}
            className={`px-btn px-btn-primary ${canCallUno ? "px-btn-urgent" : ""}`}
          >
            UNO!
          </button>

          {/* Falar vale sempre: fora da sua vez, com a mesa congelada pelo tapa
              e depois de a partida acabar. É a única coisa na mesa que nunca
              depende de estado nenhum. */}
          <EmotePicker onSend={actions.emote} />
        </div>

        <Hand
          cards={hand}
          playableIds={playableIds}
          yourTurn={yourTurn}
          dropTarget={discardRef}
          onPlay={play}
          onDragOver={setDropArmed}
        />
      </div>

      {pendingWild && (
        <WildPicker
          currentColor={state.currentColor}
          onPick={pickColor}
          onCancel={() => setPendingWild(null)}
        />
      )}

      {state.phase === "finished" && (
        <div className="fixed inset-0 z-40 grid place-content-center bg-black/70 p-4">
          <div className="px-slab flex flex-col items-center gap-4 p-8 text-center">
            <p className="px-label">Fim de partida</p>
            <p className="px-code">
              {state.players.find((player) => player.id === state.winnerId)?.name ?? "Ninguém"}
            </p>
            <p className="px-label">venceu</p>

            {/* Duas saídas para o fim da partida: outra mão, ou a porta. Quem
                não é host só tem a porta — e antes não tinha nenhuma. */}
            <div className="flex flex-col items-stretch gap-2">
              {state.hostId === sessionId ? (
                <button
                  type="button"
                  onClick={actions.restart}
                  className="px-btn px-btn-primary"
                >
                  Jogar de novo
                </button>
              ) : (
                <p className="px-label">Aguardando o host começar outra</p>
              )}
              <button type="button" onClick={onExit} className="px-btn">
                Voltar ao início
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Quais assentos abrem uma fileira nova, para a seta que vem antes deles poder
 * sumir: ela apontaria para um vizinho que está na linha de baixo, e no fim da
 * fileira ela lê como enfeite pendurado na borda.
 *
 * Some por `visibility`, e não deixando de ser desenhada: tirá-la do fluxo
 * devolveria a largura dela à fileira, o que pode caber mais um assento, o que
 * muda a quebra, o que remede — e a seta piscaria para sempre. Invisível, ela
 * guarda o lugar e a medida se estabiliza na primeira passada.
 *
 * O custo é um ResizeObserver e uma varredura de `offsetTop` a cada vez que a
 * fileira muda de tamanho: nada roda por quadro nem por jogada.
 */
function useLineStarts(seatCount: number) {
  const ref = useRef<HTMLElement>(null);
  const [starts, setStarts] = useState<number[]>([]);

  useLayoutEffect(() => {
    const row = ref.current;
    if (!row) return;

    const measure = () => {
      const seats = row.querySelectorAll<HTMLElement>(".uno-seat");
      const next: number[] = [];
      seats.forEach((seat, index) => {
        const previous = seats[index - 1];
        if (previous && seat.offsetTop > previous.offsetTop) next.push(index);
      });
      // Só troca o estado quando a quebra de fato mudou — senão cada resize
      // seria um render novo com a mesma resposta.
      setStarts((current) =>
        current.length === next.length && current.every((value, i) => value === next[i])
          ? current
          : next,
      );
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(row);
    return () => observer.disconnect();
  }, [seatCount]);

  return [ref, starts] as const;
}

/** Opponents in turn order starting after you; you are not drawn as a seat. */
function seatOrder(state: TableState, sessionId: string) {
  const index = state.players.findIndex((player) => player.id === sessionId);
  if (index === -1) return state.players;
  return [...state.players.slice(index + 1), ...state.players.slice(0, index)];
}

function useTableSounds(state: TableState, sessionId: string, handSize: number) {
  const play = useSound();
  const previous = useRef({ discardCount: 0, handSize: 0, turn: "", phase: state.phase });

  useEffect(() => {
    const before = previous.current;
    if (state.discardCount > before.discardCount) play("play");
    if (handSize > before.handSize) play("draw");
    if (state.currentPlayerId === sessionId && before.turn !== sessionId) play("turn");
    if (state.phase === "finished" && before.phase !== "finished") play("victory");
    previous.current = {
      discardCount: state.discardCount,
      handSize,
      turn: state.currentPlayerId,
      phase: state.phase,
    };
  }, [handSize, play, sessionId, state.currentPlayerId, state.discardCount, state.phase]);
}

/**
 * O tapa dos outros, pelo evento e não pela diferença de estado: o patch que
 * fecha a rodada tira duas mãos de uma vez, e olhando só o antes e o depois o
 * tapa que decide a corrida seria mudo. O seu não passa por aqui — ele já soou
 * no clique, sem esperar a ida e volta.
 */
function useSlapSound(sessionId: string, onFx?: RoomConnection["onFx"]) {
  const play = useSound();

  useEffect(() => {
    if (!onFx) return;
    return onFx((events) => {
      if (events.some((event) => event.k === "slap" && event.by !== sessionId)) {
        play("slap");
      }
    });
  }, [onFx, play, sessionId]);
}
