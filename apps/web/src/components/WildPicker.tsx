import { useEffect, useRef, useState } from "react";
import { COLOR_NAME, type PlayColor } from "@uno/shared";
import { COLOR_HEX } from "../lib/cards";

/*
 * O coringa não tem símbolo central: o símbolo é o oval da própria carta,
 * dividido em quatro pelos eixos DO OVAL. Este seletor é esse oval ampliado e
 * clicável — mesma elipse, mesma inclinação de 25°, mesmas cores e mesma ordem
 * de leitura de `uno-wild-change.svg`. Ver tools/cards/uno_card.md §0.
 *
 * O fundo é o painel, que já é feito do material do verso da carta, então o
 * oval continua assentado sobre a mesma cor de corpo que tem na carta impressa.
 */

const CX = 32;
const CY = 48;
const RU = 8.6; // semieixo menor, ao longo de u
const RV = 15.5; // semieixo maior, ao longo de v
const TILT = 25;
const CROSS = 1.6; // meia-largura da cruz divisória

/* Recorte justo ao oval girado: ele ocupa 20,4 x 29,0 dentro da carta 64x96. */
const BOX_W = 27;
const BOX_H = 35;
const VIEW_BOX = `${CX - BOX_W / 2} ${CY - BOX_H / 2} ${BOX_W} ${BOX_H}`;

/** Ordem de leitura no frame do oval: TL, TR, BL, BR. */
const QUADRANTS: { color: PlayColor; u: -1 | 1; v: -1 | 1 }[] = [
  { color: "red", u: -1, v: -1 },
  { color: "blue", u: 1, v: -1 },
  { color: "yellow", u: -1, v: 1 },
  { color: "green", u: 1, v: 1 },
];

/** Tom que a roda do coringa usa (RAMP[1]) e o tom claro do realce (RAMP[0]). */
const FILL: Record<PlayColor, string> = {
  red: "#D93A34",
  yellow: "#EDC034",
  green: "#4CA742",
  blue: "#3572C8",
};
const FILL_LIT: Record<PlayColor, string> = {
  red: "#E4483F",
  yellow: "#F5CE45",
  green: "#5BB44E",
  blue: "#3E7FD4",
};

const INK = "#1B1215";

type Props = {
  /** A cor valendo agora, oferecida como atalho para mantê-la. */
  currentColor: PlayColor | "";
  onPick: (color: PlayColor) => void;
  onCancel: () => void;
};

export function WildPicker({ currentColor, onPick, onCancel }: Props) {
  const [aimed, setAimed] = useState<PlayColor | null>(null);

  /*
   * O toque que joga o coringa gera um clique depois de soltar o dedo, e a essa
   * altura este seletor já nasceu debaixo dele: no celular a cor saía escolhida
   * sozinha — a do quadrante que calhou de estar sob o dedo — ou o fundo comia
   * o toque e o seletor fechava antes de aparecer. Um clique só vale se a
   * pressão dele também aconteceu aqui dentro; o clique fantasma vem sem
   * `pointerdown` nenhum. O teclado não passa por ponteiro, e `detail === 0` é
   * como ele se anuncia.
   */
  const pressed = useRef(false);
  const genuine = (event: { detail: number }) => pressed.current || event.detail === 0;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onCancel();
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div
      className="fixed inset-0 z-50 grid place-content-center bg-black/70 p-4"
      onPointerDown={() => (pressed.current = true)}
      onClick={(event) => genuine(event) && onCancel()}
    >
      <div
        className="px-slab flex flex-col items-center gap-4 p-6"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 className="px-title text-center">Qual cor entra em jogo?</h2>

        <div className="wild-picker">
          <svg viewBox={VIEW_BOX} aria-hidden="true">
            <g transform={`rotate(${TILT} ${CX} ${CY})`}>
              <defs>
                <clipPath id="wild-oval">
                  <ellipse cx={CX} cy={CY} rx={RU} ry={RV} />
                </clipPath>
              </defs>
              {/* a cruz divisória é o corpo aparecendo entre os quadrantes */}
              <ellipse cx={CX} cy={CY} rx={RU} ry={RV} fill={INK} />
              <g clipPath="url(#wild-oval)">
                {QUADRANTS.map(({ color, u, v }) => (
                  <rect
                    key={color}
                    x={u < 0 ? CX - RU - 2 : CX + CROSS}
                    y={v < 0 ? CY - RV - 2 : CY + CROSS}
                    width={RU + 2 - CROSS}
                    height={RV + 2 - CROSS}
                    fill={aimed === color ? FILL_LIT[color] : FILL[color]}
                  />
                ))}
              </g>
              <ellipse
                cx={CX}
                cy={CY}
                rx={RU}
                ry={RV}
                fill="none"
                stroke={INK}
                strokeWidth="1.6"
              />
            </g>
          </svg>

          {/* Alvos de clique: grade 2x2 girada junto com o oval, então cada
              alvo cobre exatamente o quadrante que pinta. */}
          <div className="wild-picker-hits">
            {QUADRANTS.map(({ color }) => (
              <button
                key={color}
                type="button"
                aria-label={COLOR_NAME[color]}
                onClick={(event) => genuine(event) && onPick(color)}
                onPointerEnter={() => setAimed(color)}
                onPointerLeave={() => setAimed(null)}
                onFocus={() => setAimed(color)}
                onBlur={() => setAimed(null)}
              />
            ))}
          </div>
        </div>

        <p className="px-label h-4">{aimed ? COLOR_NAME[aimed] : "toque um quadrante"}</p>

        {currentColor && (
          <button
            type="button"
            onClick={(event) => genuine(event) && onPick(currentColor)}
            onPointerEnter={() => setAimed(currentColor)}
            onPointerLeave={() => setAimed(null)}
            onFocus={() => setAimed(currentColor)}
            onBlur={() => setAimed(null)}
            className="px-btn flex items-center gap-2"
          >
            <span
              className="inline-block size-3"
              style={{ background: COLOR_HEX[currentColor], border: "2px solid var(--rim)" }}
            />
            Manter {COLOR_NAME[currentColor]}
          </button>
        )}
      </div>
    </div>
  );
}
