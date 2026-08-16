import { create } from "zustand";
import { loadPlayerName } from "../lib/session";

/** Client-side only. The game state lives on the server and arrives through Colyseus. */
type UiStore = {
  playerName: string;
  soundEnabled: boolean;
  setPlayerName: (name: string) => void;
  toggleSound: () => void;
};

export const useUi = create<UiStore>((set) => ({
  playerName: loadPlayerName(),
  soundEnabled: true,
  setPlayerName: (playerName) => set({ playerName }),
  toggleSound: () => set((state) => ({ soundEnabled: !state.soundEnabled })),
}));
