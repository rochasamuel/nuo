import type { ReactNode } from "react";
import { useUi } from "../store/ui";

type Props = {
  /**
   * Se a janela é grande o bastante para a mesa redonda. A chave dela só
   * aparece onde ela funciona: oferecê-la num celular seria oferecer um botão
   * que não faz nada — a fileira quebra em três linhas e a roda não cabe.
   */
  wide: boolean;
};

/**
 * Os ajustes de quem olha a mesa, ao lado dos ajustes da mesa.
 *
 * As regras da casa são do combinado e valem para todo mundo; estas duas são
 * só suas e não atravessam a rede — por isso um painel separado, e não mais
 * duas linhas dentro do `RulesMenu`, onde elas se leriam como regras de jogo.
 *
 * Mesma mecânica do vizinho: um `<details>` que pende da barra do cabeçalho,
 * com o mesmo `name` — abrir um fecha o outro, senão os dois painéis caem no
 * mesmo canto, um por cima do outro.
 */
export function ConfigMenu({ wide }: Props) {
  const seatLayout = useUi((ui) => ui.seatLayout);
  const setSeatLayout = useUi((ui) => ui.setSeatLayout);
  const lowMotion = useUi((ui) => ui.lowMotion);
  const setLowMotion = useUi((ui) => ui.setLowMotion);

  return (
    <details className="uno-rules" name="uno-header">
      <summary className="px-link" aria-label="Ajustes da tela">
        ▤ ajustes
      </summary>

      <div className="px-slab uno-rules-panel flex flex-col gap-3 p-4">
        {wide && (
          <Switch
            on={seatLayout === "ring"}
            onToggle={() => setSeatLayout(seatLayout === "ring" ? "row" : "ring")}
            label="Mesa redonda"
            hint="Os assentos em roda em volta das pilhas, no lugar da fileira no topo."
          />
        )}
        <Switch
          on={lowMotion}
          onToggle={() => setLowMotion(!lowMotion)}
          label="Movimento reduzido"
          state={["ligado", "desligado"]}
          hint="As cartas trocam de lugar sem voar, e nada pisca. O sistema pode ligar isto sozinho."
        />
      </div>
    </details>
  );
}

/**
 * Preenchido é ligada, vazado é desligada — a mesma leitura do ponto de
 * conexão nos assentos e das regras no menu ao lado. A linha inteira é o
 * botão: o alvo é o texto que se está lendo, e não o quadradinho de 8px.
 */
function Switch({
  on,
  onToggle,
  label,
  hint,
  /* O rótulo do estado concorda com o nome da chave — "mesa redonda ligada",
     "movimento reduzido ligado" —, então quem escreve o nome escolhe o par. */
  state = ["ligada", "desligada"],
}: {
  on: boolean;
  onToggle: () => void;
  label: string;
  hint: ReactNode;
  state?: readonly [string, string];
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={onToggle}
      className="uno-switch flex items-start gap-2 text-left"
    >
      {/* O estado mora no `aria-checked`, e o CSS o lê de lá: uma verdade só
          para o leitor de tela e para os olhos. */}
      <span aria-hidden className="uno-switch-dot mt-1 inline-block size-2 shrink-0" />
      <span className="flex flex-col">
        <span className="uno-switch-label text-sm">
          {label}
          <span className="px-label ml-2">{on ? state[0] : state[1]}</span>
        </span>
        <span className="text-xs" style={{ color: "var(--paper-sh)" }}>
          {hint}
        </span>
      </span>
    </button>
  );
}
