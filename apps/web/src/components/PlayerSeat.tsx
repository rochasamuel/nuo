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
        // No celular o assento é uma faixa baixa: nome e contador dividem uma
        // linha só. Com dez lugares na mesa é a altura da fileira que come a
        // tela, e o que sobra dela é a mesa. A largura não encolhe junto — o
        // nome precisa caber, e é ele que diz de quem é o assento.
        "uno-seat flex w-32 flex-col items-center gap-1 px-2 py-1 text-center",
        "sm:px-3 sm:py-2",
        active && "uno-seat-active",
        pickable && "uno-seat-pick",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {/*
        Duas coisas curtas — quem é, quanto tem — e duas maneiras de arrumá-las.
        No celular elas dividem a linha e se leem como um placar: nome à
        esquerda, contador preso à direita pelo `ml-auto`, o que alinha os
        números de um assento para o outro. Empilhá-las lá dobraria a altura da
        fileira, que é justamente o que falta na tela pequena.

        De `sm` para cima sobra largura e falta motivo para apertar: o
        `basis-full` joga o contador para a linha de baixo e o assento volta a
        ser o quadrado centrado de sempre, com o nome inteiro à disposição.
      */}
      {/* `flex-nowrap` no celular: numa linha que pode quebrar, o flex quebra
          antes de encolher, e o nome comprido mandaria o contador para baixo em
          vez de cortar. De `sm` para cima a quebra é justamente o que põe o
          contador na sua própria linha. */}
      <span className="flex w-full flex-nowrap items-center justify-center gap-1 text-xs sm:flex-wrap">
        <span
          className="inline-block size-2 shrink-0"
          style={{ background: player.connected ? "var(--green)" : "var(--gloss)" }}
          title={player.connected ? "conectado" : "desconectado"}
        />
        {isHost && (
          <span className="shrink-0" title="host">
            👑
          </span>
        )}
        {/* `min-w-0` para o nome poder encolher: sem ele um "Ana Beatriz" se
            recusa a cortar e empurra o contador para a linha de baixo, que é
            justamente a linha que o celular não tem. */}
        <span
          className="min-w-0 truncate"
          title={player.name}
          style={{ color: "var(--paper-hi)" }}
        >
          {player.name}
        </span>

        <span
          className="ml-auto flex shrink-0 items-center gap-1 sm:ml-0 sm:basis-full sm:justify-center"
          style={{ color: "var(--paper-sh)" }}
        >
          <img src={BACK_URL} alt="" className="h-4 w-auto sm:h-5" />
          {cardCount}
        </span>
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
