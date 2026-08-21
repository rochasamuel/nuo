import { useSyncExternalStore } from "react";

/**
 * Uma media query que o JavaScript também precisa saber.
 *
 * Quase tudo que muda com a largura da tela é o CSS quem resolve. A mesa
 * redonda não: ela precisa das contas das posições, e uma conta feita para uma
 * tela grande numa tela pequena não é um enfeite fora do lugar, é um assento
 * em cima do outro. Então o corte de largura mora aqui, num lugar só, e o CSS
 * segue a classe que este resultado liga.
 */
export function useMediaQuery(query: string) {
  return useSyncExternalStore(
    (onChange) => {
      if (typeof matchMedia !== "function") return () => {};
      const media = matchMedia(query);
      media.addEventListener("change", onChange);
      return () => media.removeEventListener("change", onChange);
    },
    () => typeof matchMedia === "function" && matchMedia(query).matches,
    () => false,
  );
}
