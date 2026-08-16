import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Room } from "@colyseus/sdk";
import type {
  Card,
  ErrorMessage,
  FxEvent,
  FxMessage,
  HandMessage,
  JoinRoomOptions,
  PlayColor,
  TableState,
} from "@uno/shared";
import { client } from "../lib/colyseus";
import { takePendingRoom } from "../lib/pendingRoom";
import { clearSession, loadPlayerName, loadSession, saveSession } from "../lib/session";

export type ConnectionStatus = "connecting" | "naming" | "connected" | "lost";

const EMPTY_HAND: HandMessage = { cards: [], playableIds: [] };

export type RoomConnection = {
  status: ConnectionStatus;
  /** Set while the socket is down and the SDK is retrying. */
  dropped: boolean;
  error: string;
  /** Last rejection from the server, shown briefly and then dismissed. */
  notice: string;
  state: TableState | null;
  hand: Card[];
  playableIds: Set<string>;
  sessionId: string;
  join: (playerName: string) => Promise<void>;
  leave: () => void;
  actions: RoomActions;
  /**
   * Assina os eventos de animação. Não é estado do React de propósito: eles
   * descrevem um instante, não uma situação, e guardá-los em `useState` obrigaria
   * quem consome a limpar a fila — com a corrida de sempre entre esvaziar e
   * receber. Devolve a função que cancela a assinatura.
   */
  onFx: (handler: (events: FxEvent[]) => void) => () => void;
};

export type RoomActions = {
  start: () => void;
  play: (cardId: string, color?: PlayColor) => void;
  draw: () => void;
  pass: () => void;
  callUno: () => void;
  catchUno: (targetId: string) => void;
  restart: () => void;
};

export function useRoomConnection(code: string): RoomConnection {
  const roomRef = useRef<Room | null>(null);
  const fxHandlers = useRef(new Set<(events: FxEvent[]) => void>());
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [dropped, setDropped] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [state, setState] = useState<TableState | null>(null);
  const [hand, setHand] = useState<HandMessage>(EMPTY_HAND);
  const [sessionId, setSessionId] = useState("");

  const attach = useCallback(
    (room: Room, playerName: string) => {
      roomRef.current = room;
      setSessionId(room.sessionId);
      setStatus("connected");
      setDropped(false);
      setError("");
      saveSession(code, { reconnectionToken: room.reconnectionToken, playerName });

      room.onStateChange(() => setState(room.state.toJSON() as TableState));
      room.onMessage("hand", (message: HandMessage) => setHand(message));
      room.onMessage("error", (message: ErrorMessage) => setNotice(message.message));
      room.onMessage("fx", (events: FxMessage) => {
        for (const handler of fxHandlers.current) handler(events);
      });
      room.onDrop(() => setDropped(true));
      room.onReconnect(() => {
        setDropped(false);
        saveSession(code, { reconnectionToken: room.reconnectionToken, playerName });
      });
      room.onLeave(() => {
        roomRef.current = null;
        setStatus("lost");
        setHand(EMPTY_HAND);
      });
    },
    [code],
  );

  const join = useCallback(
    async (playerName: string) => {
      setStatus("connecting");
      setError("");
      try {
        const room = await client.joinById(code, { playerName } satisfies JoinRoomOptions);
        attach(room, playerName);
      } catch (cause) {
        clearSession(code);
        setError(joinError(cause));
        setStatus("naming");
      }
    },
    [attach, code],
  );

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const saved = loadSession(code);

      const handedOver = takePendingRoom(code);
      if (handedOver) return attach(handedOver, saved?.playerName ?? loadPlayerName());

      if (saved?.reconnectionToken) {
        try {
          const room = await client.reconnect(saved.reconnectionToken);
          if (cancelled) return room.leave();
          return attach(room, saved.playerName);
        } catch {
          clearSession(code);
          if (cancelled) return;
        }
      }

      const name = saved?.playerName || loadPlayerName();
      if (!name) return setStatus("naming");
      if (!cancelled) await join(name);
    })();

    return () => {
      cancelled = true;
      roomRef.current?.removeAllListeners();
      roomRef.current?.leave();
      roomRef.current = null;
    };
  }, [attach, code, join]);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 2600);
    return () => clearTimeout(timer);
  }, [notice]);

  const leave = useCallback(() => {
    roomRef.current?.leave(true);
    clearSession(code);
  }, [code]);

  const actions = useMemo<RoomActions>(
    () => ({
      start: () => roomRef.current?.send("start"),
      play: (cardId, color) => roomRef.current?.send("play", { cardId, color }),
      draw: () => roomRef.current?.send("draw"),
      pass: () => roomRef.current?.send("pass"),
      callUno: () => roomRef.current?.send("uno"),
      catchUno: (targetId) => roomRef.current?.send("catch", { targetId }),
      restart: () => roomRef.current?.send("restart"),
    }),
    [],
  );

  const onFx = useCallback((handler: (events: FxEvent[]) => void) => {
    const handlers = fxHandlers.current;
    handlers.add(handler);
    return () => handlers.delete(handler);
  }, []);

  const playableIds = useMemo(() => new Set(hand.playableIds), [hand]);

  return {
    status,
    dropped,
    error,
    notice,
    state,
    hand: hand.cards,
    playableIds,
    sessionId,
    join,
    leave,
    actions,
    onFx,
  };
}

function joinError(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : String(cause);
  if (/not found|locked|no rooms|full/i.test(message)) {
    return "Sala não encontrada, cheia ou com partida já em andamento.";
  }
  return message || "Não foi possível entrar na sala.";
}
