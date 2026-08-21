import { useEffect, useLayoutEffect, useRef } from "react";
import { toCard, type FxEvent, type TableState } from "@uno/shared";
import { artUrl, scatter } from "../lib/cards";
import { clearFlights, flyDeal, flyDraw, flyPlay, flyRecycle, flySwap } from "./flights";
import type { RoomConnection } from "./useRoomConnection";

type Deal = { seat: string | null; count: number };

/**
 * Uma jogada anunciada, à espera do estado que diga qual carta foi.
 * `mine` é só um lugar na fila: a sua carta já partiu no clique, com a pose e a
 * origem que só o clique conhecia. Guardar a vaga é o que mantém as jogadas dos
 * outros alinhadas com as cartas que entram no descarte.
 */
type Pending = { kind: "seat"; id: string } | { kind: "deck" } | { kind: "mine" };

/**
 * Traduz os eventos do servidor em voos de carta.
 *
 * Mora no `RoomScreen`, e não na `Table`: o reparto inicial é anunciado antes de
 * a partida existir, e nessa hora a mesa ainda nem montou. Quem assina precisa
 * estar de pé o tempo todo.
 *
 * Os eventos chegam em três tempos, e é isso que explica a forma do arquivo:
 *
 *   · comprar e reembaralhar se resolvem na hora — o verso é sempre o mesmo
 *     desenho, e as duas pontas do voo já estão na tela;
 *   · uma carta baixada precisa da CARA, que só vem no patch de estado. Fica de
 *     molho até o descarte crescer;
 *   · o reparto inicial precisa das ÂNCORAS, que só nascem com a mesa. Fica de
 *     molho até a partida virar `playing`.
 */
export function useFlights(
  state: TableState | null,
  sessionId: string,
  onFx: RoomConnection["onFx"],
) {
  /** Quem baixou uma carta e ainda espera o estado dizer qual foi. */
  const awaiting = useRef<Pending[]>([]);
  /** O reparto anunciado, à espera de uma mesa onde pousar. */
  const pendingDeal = useRef<Deal[]>([]);
  /** Tamanho do descarte na última vez que se olhou. -1 antes da primeira. */
  const seenDiscard = useRef(-1);
  const me = useRef(sessionId);
  me.current = sessionId;

  useEffect(() => clearFlights, []);

  useEffect(
    () =>
      onFx((events) => {
        // O reparto vem como um evento por jogador, mas o escalonamento precisa
        // enxergar a mesa toda de uma vez para distribuir em rodadas.
        const deals = events.filter((event) => event.k === "deal");
        if (deals.length > 0) {
          pendingDeal.current = deals.map((event) => ({
            seat: event.to === me.current ? null : event.to,
            count: event.n,
          }));
          // Uma revanche recomeça o descarte do zero. Sem zerar as contas aqui,
          // a queda de 30 cartas para 1 leria como "nada foi baixado" e a
          // virada inicial ficaria presa na fila, atrasando todas as jogadas
          // seguintes em uma.
          awaiting.current = [];
          seenDiscard.current = 0;
        }
        for (const event of events) dispatch(event, me.current, awaiting.current);
      }),
    [onFx],
  );

  /*
   * `useLayoutEffect` e não `useEffect`: quem espera uma carta pousar só descobre
   * isso quando o voo nasce. Num efeito comum o navegador chegaria a pintar o
   * destino com a carta antes disso — um quadro de carta duplicada.
   */
  useLayoutEffect(() => {
    if (!state) return;

    if (pendingDeal.current.length > 0 && state.phase === "playing") {
      // Numa revanche, o que sobrou da partida anterior não tem mais destino.
      clearFlights();
      flyDeal(pendingDeal.current);
      pendingDeal.current = [];
    }

    /*
     * Quantas cartas entraram no descarte desde o último olhar — e não "o topo
     * mudou". Duas jogadas podem cair no mesmo patch, e contar uma só deixaria
     * a fila torta para sempre: dali em diante toda carta sairia do assento do
     * jogador anterior. Aqui a fila se realinha sozinha.
     *
     * Delta negativo é o reembaralhar, que devolve o descarte ao monte e não
     * baixou carta nenhuma: só se reanota o tamanho.
     */
    const before = seenDiscard.current;
    const delta = state.discardCount - before;
    seenDiscard.current = state.discardCount;
    if (before < 0 || delta <= 0) return;

    // Só a carta que ficou por cima é visível; animar as soterradas seria
    // desenhar cartas que já não estão lá.
    const source = awaiting.current.splice(0, delta).at(-1);
    const top = state.discard.at(-1);
    if (!top || !source || source.kind === "mine") return;

    // A mesma pose que o DiscardPile vai dar à carta parada, para o voo terminar
    // exatamente onde ela fica e nada mais se mexer depois do pouso.
    const { rot, dx, dy } = scatter(state.discardCount - 1, state.discardCount, true);
    flyPlay(source, { id: top.id, art: artUrl(toCard(top)) }, { rot, dx, dy });
  }, [state]);
}

/** Lança o que já dá para lançar; enfileira o que ainda depende do estado. */
function dispatch(event: FxEvent, sessionId: string, awaiting: Pending[]) {
  switch (event.k) {
    case "deal":
      return; // tratado em lote, para o escalonamento sair em rodadas
    case "draw":
      return flyDraw({
        toSeat: event.to === sessionId ? null : event.to,
        count: event.n,
      });
    case "play":
      awaiting.push(
        event.by === sessionId ? { kind: "mine" } : { kind: "seat", id: event.by },
      );
      return;
    case "flip":
      awaiting.push({ kind: "deck" });
      return;
    case "recycle":
      return flyRecycle();
    case "swap":
      return flySwap(
        event.a === sessionId ? null : event.a,
        event.b === sessionId ? null : event.b,
      );
    case "slap":
      // Não é um voo: nenhuma carta se move. Quem escuta é a mesa, que toca o
      // som do tapa. Aqui só se reconhece o evento.
      return;
  }
}
