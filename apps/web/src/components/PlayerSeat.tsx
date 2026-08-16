import type { PublicPlayer } from "@uno/shared";
import { anchorRef, heldSeatCount, useFlightStore } from "../game/flights";
import { BACK_URL } from "../lib/cards";

type Props = {
  player: PublicPlayer;
  active: boolean;
  isHost: boolean;
  /** Este jogador esqueceu o UNO e a carência já passou: dá para pegá-lo agora. */
  catchable: boolean;
  onCatch: () => void;
};

export function PlayerSeat({ player, active, isHost, catchable, onCatch }: Props) {
  // O contador só sobe quando a carta pousa: vê-lo mudar antes de a carta
  // chegar entrega que o número e o desenho são duas coisas separadas.
  const airborne = useFlightStore(heldSeatCount(player.id));
  const cardCount = Math.max(0, player.cardCount - airborne);

  return (
    <div
      ref={anchorRef(`seat:${player.id}`)}
      className={`uno-seat flex w-32 flex-col items-center gap-1 px-3 py-2 text-center ${
        active ? "uno-seat-active" : ""
      }`}
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
    </div>
  );
}
