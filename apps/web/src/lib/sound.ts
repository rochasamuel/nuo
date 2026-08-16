import { useCallback } from "react";
import { useUi } from "../store/ui";

export type SoundName = "draw" | "play" | "action" | "turn" | "uno" | "victory";

/** Drop an mp3 named after the effect into `public/sounds/` and it starts playing. */
const cache = new Map<SoundName, HTMLAudioElement>();

function get(name: SoundName) {
  let audio = cache.get(name);
  if (!audio) {
    audio = new Audio(`/sounds/${name}.mp3`);
    audio.volume = 0.5;
    cache.set(name, audio);
  }
  return audio;
}

export function useSound() {
  const enabled = useUi((state) => state.soundEnabled);

  return useCallback(
    (name: SoundName) => {
      if (!enabled) return;
      const audio = get(name);
      audio.currentTime = 0;
      // Missing file, or a browser that has not seen a gesture yet: not worth reporting.
      void audio.play().catch(() => {});
    },
    [enabled],
  );
}
