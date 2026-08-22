import { RULES, type HouseRules } from "@uno/shared";

type Props = {
  /** O combinado da mesa, decidido ao abrir e imutável depois. */
  rules: HouseRules;
};

/**
 * O combinado em vigor, à mão durante a partida.
 *
 * No lobby as regras estão escritas na tela, mas quem entrou há três mãos já
 * não as tem à vista — e são elas que decidem se responder um +2 com outro é
 * jogada ou erro. Fica no cabeçalho, fechado, porque é consulta e não aviso.
 *
 * `<details>` e não um menu de verdade: abrir, fechar, o Esc e o foco são do
 * navegador, e o que sobra para escrever é a aparência.
 *
 * O painel se posiciona pelo ancestral posicionado mais próximo — na mesa, a
 * própria barra do cabeçalho —, de propósito: alinhado à borda dela, cabe na
 * janela em qualquer largura. Ver `.uno-rules-panel` no index.css.
 */
export function RulesMenu({ rules }: Props) {
  const on = RULES.filter(({ key }) => rules[key]).length;

  return (
    // O `name` emparelha este painel com o de ajustes: abrir um fecha o outro,
    // porque os dois caem no mesmo canto da barra.
    <details className="uno-rules" name="uno-header">
      <summary className="px-link" aria-label="Regras da casa">
        {/* A conta no rótulo é o que se quer saber de relance: se a mesa tem
            alguma variação de pé. Abrir é para descobrir quais.

            No celular fica só ela, ao lado da engrenagem: numa tira de uma
            linha a palavra "regras" custa o lugar do nome da mesa, e a conta é
            justamente a parte que não dá para adivinhar do desenho. O nome
            inteiro continua no `aria-label`. */}
        ⚙ <span className="hidden sm:inline">regras · </span>
        {on}/{RULES.length}
      </summary>

      <div className="px-slab uno-rules-panel flex flex-col gap-3 p-4">
        {RULES.map(({ key, label, hint }) => (
          <p key={key} className="flex items-start gap-2 text-left">
            {/* Preenchido é ligada, vazado é desligada — a mesma leitura do
                ponto de conexão nos assentos. */}
            <span
              aria-hidden
              className="mt-1 inline-block size-2 shrink-0"
              style={{
                background: rules[key] ? "var(--mark)" : "transparent",
                border: "2px solid var(--gloss)",
              }}
            />
            <span className="flex flex-col">
              <span
                className="text-sm"
                style={{ color: rules[key] ? "var(--paper-hi)" : "var(--gloss)" }}
              >
                {label}
                <span className="px-label ml-2">{rules[key] ? "ligada" : "desligada"}</span>
              </span>
              <span className="text-xs" style={{ color: "var(--paper-sh)" }}>
                {hint}
              </span>
            </span>
          </p>
        ))}
      </div>
    </details>
  );
}
