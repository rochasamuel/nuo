/**
 * Just enough in localStorage to get back into a room after a refresh.
 * The game state itself is never stored here — the server owns it.
 */

export type StoredSession = {
  reconnectionToken: string;
  playerName: string;
};

const sessionKey = (code: string) => `uno:session:${code}`;
const NAME_KEY = "uno:name";

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
