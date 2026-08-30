/**
 * Just enough in localStorage to get back into a room after a refresh — e para
 * a próxima mesa nascer parecida com a última. O estado do jogo nunca entra
 * aqui: ele é do servidor.
 */

import {
  DEFAULT_MAX_PLAYERS,
  DEFAULT_RULES,
  MAX_PLAYERS,
  MIN_PLAYERS,
  RULES,
  type HouseRules,
} from "@uno/shared";

export type StoredSession = {
  reconnectionToken: string;
  playerName: string;
  /**
   * A chave da cadeira nesta mesa. Ao contrário do `reconnectionToken`, que o
   * servidor troca a cada reconexão, esta não muda nunca — é ela que devolve o
   * lugar a quem voltou com o token velho na mão. Ver `seatKey` no
   * `@uno/shared`.
   */
  seatKey: string;
};

/**
 * Como a última mesa foi aberta. Quem joga toda semana abre a mesa toda semana
 * com o mesmo combinado, e remarcar as mesmas caixas todas as vezes é trabalho
 * que o navegador pode fazer.
 */
export type StoredSetup = {
  roomName: string;
  maxPlayers: number;
  rules: HouseRules;
};

/**
 * A chave desta mesa: a que já existe, ou uma nova.
 *
 * Sorteada, e nunca derivada do nome: é uma credencial ao portador, e um nome
 * seria adivinhável — bastaria digitar "Ana" para sentar na cadeira da Ana
 * enquanto ela estivesse caída.
 */
export function seatKeyFor(code: string): string {
  const saved = loadSession(code)?.seatKey;
  return saved || newSeatKey();
}

export const newSeatKey = () =>
  typeof crypto?.randomUUID === "function"
    ? crypto.randomUUID()
    : // Navegador sem `randomUUID` (http em rede local, por exemplo): duas
      // rodadas de base 36 dão entropia de sobra para uma mesa de dez pessoas.
      `${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;

const sessionKey = (code: string) => `uno:session:${code}`;
const NAME_KEY = "uno:name";
const SETUP_KEY = "uno:setup";
const PREFS_KEY = "uno:prefs";

export function loadSession(code: string): StoredSession | null {
  try {
    const raw = localStorage.getItem(sessionKey(code));
    return raw ? (JSON.parse(raw) as StoredSession) : null;
  } catch {
    return null;
  }
}

export function saveSession(code: string, session: StoredSession) {
  localStorage.setItem(sessionKey(code), JSON.stringify(session));
  localStorage.setItem(NAME_KEY, session.playerName);
}

export function clearSession(code: string) {
  localStorage.removeItem(sessionKey(code));
}

export const loadPlayerName = () => localStorage.getItem(NAME_KEY) ?? "";

export function saveSetup(setup: StoredSetup) {
  localStorage.setItem(SETUP_KEY, JSON.stringify(setup));
}

/**
 * O que ficou guardado, campo a campo e sempre válido. O que está no
 * localStorage é de uma versão anterior do jogo ou do que alguém digitou lá:
 * uma regra que não existe mais, um número de lugares fora da faixa. Cada campo
 * que não passa vira o padrão, em vez de a tela inteira desistir.
 */
export function loadSetup(): StoredSetup {
  const fallback: StoredSetup = {
    roomName: "Sexta-feira UNO",
    maxPlayers: DEFAULT_MAX_PLAYERS,
    rules: { ...DEFAULT_RULES },
  };

  let stored: Partial<StoredSetup>;
  try {
    stored = JSON.parse(localStorage.getItem(SETUP_KEY) ?? "") as Partial<StoredSetup>;
  } catch {
    return fallback;
  }
  if (!stored || typeof stored !== "object") return fallback;

  const seats = Number(stored.maxPlayers);
  return {
    roomName:
      typeof stored.roomName === "string" && stored.roomName.trim()
        ? stored.roomName
        : fallback.roomName,
    maxPlayers:
      seats >= MIN_PLAYERS && seats <= MAX_PLAYERS ? Math.round(seats) : fallback.maxPlayers,
    // A lista de regras é a autoridade: uma chave que não está nela não volta.
    rules: Object.fromEntries(
      RULES.map(({ key }) => [key, stored.rules?.[key] === true]),
    ) as HouseRules,
  };
}

/**
 * O que a pessoa ajustou na mesa — não o combinado da partida, que é do
 * servidor, mas como ela quer VER a mesa. Fica aqui pelo mesmo motivo que o
 * nome: quem desliga o movimento uma vez não quer religá-lo toda sexta.
 */
export type SeatLayout = "row" | "ring";
export type StoredPrefs = {
  seatLayout: SeatLayout;
  lowMotion: boolean;
};

export function savePrefs(prefs: StoredPrefs) {
  localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
}

/** Campo a campo e sempre válido, como o `loadSetup` logo acima. */
export function loadPrefs(): StoredPrefs {
  const fallback: StoredPrefs = { seatLayout: "row", lowMotion: false };

  let stored: Partial<StoredPrefs>;
  try {
    stored = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "") as Partial<StoredPrefs>;
  } catch {
    return fallback;
  }
  if (!stored || typeof stored !== "object") return fallback;

  return {
    seatLayout: stored.seatLayout === "ring" ? "ring" : "row",
    lowMotion: stored.lowMotion === true,
  };
}
