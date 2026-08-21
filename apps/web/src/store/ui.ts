import { create } from "zustand";
import { prefersReducedMotion, watchReducedMotion } from "../lib/motion";
import { loadPlayerName, loadPrefs, savePrefs, type SeatLayout } from "../lib/session";

const prefs = loadPrefs();

/** Client-side only. The game state lives on the server and arrives through Colyseus. */
type UiStore = {
  playerName: string;
  soundEnabled: boolean;
  /** Como os assentos se arrumam: a fileira de sempre ou a mesa redonda. */
  seatLayout: SeatLayout;
  /** A chave da mesa; a do sistema entra por `isLowMotion`. */
  lowMotion: boolean;
  setPlayerName: (name: string) => void;
  toggleSound: () => void;
  setSeatLayout: (layout: SeatLayout) => void;
  setLowMotion: (low: boolean) => void;
};

export const useUi = create<UiStore>((set, get) => ({
  playerName: loadPlayerName(),
  soundEnabled: true,
  seatLayout: prefs.seatLayout,
  lowMotion: prefs.lowMotion,
  setPlayerName: (playerName) => set({ playerName }),
  toggleSound: () => set((state) => ({ soundEnabled: !state.soundEnabled })),
  setSeatLayout: (seatLayout) => {
    set({ seatLayout });
    savePrefs({ seatLayout, lowMotion: get().lowMotion });
  },
  setLowMotion: (lowMotion) => {
    set({ lowMotion });
    savePrefs({ seatLayout: get().seatLayout, lowMotion });
  },
}));

/**
 * A resposta que o resto do código quer: a mesa se move ou não?
 *
 * Fora do React de propósito — quem mais pergunta é o `flights.ts`, que decide
 * no meio de uma jogada se a carta voa, e não durante um render.
 */
export const isLowMotion = () => useUi.getState().lowMotion || prefersReducedMotion();

/**
 * Uma classe no <html> e o CSS inteiro segue. É por aqui que a chave da mesa
 * alcança as animações que moram na folha de estilo: elas ficam sob
 * `.motion-off`, e não sob a media query, porque a media query só ouve o
 * sistema. Ver "movimento reduzido" no index.css.
 */
export function syncMotionClass() {
  const apply = () => document.documentElement.classList.toggle("motion-off", isLowMotion());
  apply();
  useUi.subscribe(apply);
  watchReducedMotion(apply);
}
