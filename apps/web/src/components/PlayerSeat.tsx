import type { PublicPlayer } from "@uno/shared";
import { anchorRef, heldSeatCount, useFlightStore } from "../game/flights";
import type { Bubble } from "../game/useEmotes";
import { BACK_URL } from "../lib/cards";
import { EmoteBubble } from "./EmoteBubble";

type Props = {
  player: PublicPlayer;
  active: boolean;
  isHost: boolean;
  /** Este jogador esqueceu o UNO e a carência já passou: dá para pegá-lo agora. */
  catchable: boolean;
  onCatch: () => void;
  /**
   * A troca no 7 é sua e este assento é um alvo: o quadro inteiro vira botão.
   * Alvo grande porque a escolha é no celular, com o polegar, e porque o que se
   * está mirando é uma pessoa — nome e número de cartas —, e não um botãozinho.
   */
  pickable: boolean;
  onPick: () => void;
  /** É ele quem está escolhendo a troca. Vale para quem assiste saber por quem espera. */
  choosing: boolean;
  /** O que ele está dizendo agora, enquanto o balão dura. */
  bubble?: Bubble;
};

export function PlayerSeat({
  player,
  active,
  isHost,
  catchable,
  onCatch,
  pickable,
  onPick,
  choosing,
  bubble,
}: Props) {
  // O contador só sobe quando a carta pousa: vê-lo mudar antes de a carta
  // chegar entrega que o número e o desenho são duas coisas separadas.
  const airborne = useFlightStore(heldSeatCount(player.id));
  const cardCount = Math.max(0, player.cardCount - airborne);

  return (
    <div
      ref={anchorRef(`seat:${player.id}`)}
      className={[
        "uno-seat flex w-32 flex-col items-center gap-1 px-3 py-2 text-center",
        active && "uno-seat-active",
        pickable && "uno-seat-pick",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <span className="flex w-full items-center justify-center gap-1 text-xs">
        <span
          className="inline-block size-2"
          style={{ background: player.connected ? "var(--green)" : "var(--gloss)" }}
          title={player.connected ? "conectado" : "desconectado"}
        />
        {isHost && <span title="host">👑</span>}
        <span className="truncate" style={{ color: "var(--paper-hi)" }}>
          {player.name}
        </span>
      </span>

      <span className="flex items-center gap-1 text-xs" style={{ color: "var(--paper-sh)" }}>
        <img src={BACK_URL} alt="" className="h-5 w-auto" />
        {cardCount}
      </span>

      {player.calledUno && cardCount === 1 && (
        <span className="px-label" style={{ color: "var(--mark)" }}>
          UNO!
        </span>
      )}

      {/* Quem assiste precisa saber por quem a mesa está parada. Para quem
          escolhe isto não aparece: ele não é um dos assentos. */}
      {choosing && (
        <span className="px-label" style={{ color: "var(--mark)" }}>
          escolhendo<span className="px-caret">▌</span>
        </span>
      )}

      {/* Só nasce quando já dá para clicar. Mostrá-lo desabilitado durante a
          carência entregava o alvo: bastava parar o cursor ali e esperar. */}
      {catchable && (
        <button
          type="button"
          onClick={onCatch}
          title="Ele esqueceu de gritar UNO"
          className="px-btn px-btn-primary px-btn-urgent px-pop px-2 py-1"
        >
          Pegar
        </button>
      )}

      {/*
        A etiqueta diz o que o clique faz; quem recebe o clique é a chapa que
        cobre o assento inteiro. Dois elementos e não um botão só porque o alvo
        precisa ser do tamanho do quadro — e o quadro já é feito de nome,
        contador e balão, que não podem virar filhos de um botão.
      */}
      {pickable && (
        <>
          <span className="uno-swap-chip px-label px-pop">trocar</span>
          <button
            type="button"
            className="uno-swap-hit"
            onClick={onPick}
            aria-label={`Trocar de mão com ${player.name}, ${cardCount} cartas`}
            title={`Trocar de mão com ${player.name}`}
          />
        </>
      )}

      {/* Pendurado no assento, e não empilhado dentro dele: os balões vão e
          vêm a cada poucos segundos, e no fluxo normal cada um deles esticaria
          o assento e sacudiria a fileira inteira. A chave é o `seq`, para o
          mesmo emoji repetido saltar de novo em vez de ficar parado. */}
      {bubble && (
        <span className="absolute top-full left-1/2 z-20 -translate-x-1/2 pt-1">
          <EmoteBubble key={bubble.seq} emote={bubble.emote} />
        </span>
      )}
    </div>
  );
}
