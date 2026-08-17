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

const sessionKey = (code: string) => `uno:session:${code}`;
const NAME_KEY = "uno:name";
const SETUP_KEY = "uno:setup";

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
