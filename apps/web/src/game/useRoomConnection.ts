import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Room } from "@colyseus/sdk";
import type {
  Card,
  Emote,
  EmoteEvent,
  EmoteMessage,
  ErrorMessage,
  FxEvent,
  FxMessage,
  HandMessage,
  JoinRoomOptions,
  PlayColor,
  SwapMessage,
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
  /** Tenta voltar para a mesa depois de o lugar ter sido perdido. */
  retry: () => void;
  leave: () => void;
  actions: RoomActions;
  /**
   * Assina os eventos de animação. Não é estado do React de propósito: eles
   * descrevem um instante, não uma situação, e guardá-los em `useState` obrigaria
   * quem consome a limpar a fila — com a corrida de sempre entre esvaziar e
   * receber. Devolve a função que cancela a assinatura.
   */
  onFx: (handler: (events: FxEvent[]) => void) => () => void;
  /** Assina a conversa da mesa, pelo mesmo motivo e do mesmo jeito que `onFx`. */
  onEmote: (handler: (event: EmoteEvent) => void) => () => void;
};

export type RoomActions = {
  start: () => void;
  play: (cardId: string, color?: PlayColor) => void;
  draw: () => void;
  pass: () => void;
  callUno: () => void;
  catchUno: (targetId: string) => void;
  /** Bater no 9 que está no topo do descarte. */
  slap: () => void;
  /** Dizer com quem trocar a mão, depois de baixar um 7. */
  swap: (targetId: string) => void;
  /** Falar com a mesa. Vale em qualquer momento, inclusive fora da sua vez. */
  emote: (emote: Emote) => void;
  restart: () => void;
};

export function useRoomConnection(code: string): RoomConnection {
  const roomRef = useRef<Room | null>(null);
  const fxHandlers = useRef(new Set<(events: FxEvent[]) => void>());
  const emoteHandlers = useRef(new Set<(event: EmoteEvent) => void>());
  /** Uma tentativa de cada vez, e nenhuma depois que a tela sai. */
  const busy = useRef(false);
  const alive = useRef(true);
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
      room.onMessage("emote", (event: EmoteEvent) => {
        for (const handler of emoteHandlers.current) handler(event);
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
        if (!alive.current) return void room.leave();
        attach(room, playerName);
      } catch (cause) {
        clearSession(code);
        setError(joinError(cause));
        setStatus("naming");
      }
    },
    [attach, code],
  );

  /**
   * O caminho de volta para a mesa, em ordem de preferência: a sala que a tela
   * inicial já abriu, o token que guarda o lugar, e por fim uma entrada nova
   * pelo nome. Serve tanto para a primeira vez quanto para a volta depois de o
   * celular congelar a aba — é o mesmo caminho, e a única diferença é que na
   * volta já existe um token para gastar.
   */
  const connect = useCallback(async () => {
    if (roomRef.current || busy.current || !alive.current) return;
    busy.current = true;
    const saved = loadSession(code);

    try {
      const handedOver = takePendingRoom(code);
      if (handedOver) return attach(handedOver, saved?.playerName ?? loadPlayerName());

      const name = saved?.playerName || loadPlayerName();
      // Sem token e sem nome não há o que tentar: quem chega assim vem do link
      // de convite e precisa se apresentar primeiro.
      if (!saved?.reconnectionToken && !name) return setStatus("naming");

      setStatus("connecting");
      setError("");

      if (saved?.reconnectionToken) {
        try {
          const room = await client.reconnect(saved.reconnectionToken);
          if (!alive.current) return void room.leave();
          return attach(room, saved.playerName);
        } catch {
          clearSession(code);
          if (!alive.current) return;
        }
      }

      if (!name) return setStatus("naming");

      try {
        const room = await client.joinById(code, { playerName: name } satisfies JoinRoomOptions);
        if (!alive.current) return void room.leave();
        attach(room, name);
      } catch (cause) {
        if (!alive.current) return;
        setError(joinError(cause));
        // Quem nunca sentou precisa do formulário de nome; quem já estava na
        // mesa precisa do motivo e de um botão para tentar de novo.
        setStatus(saved ? "lost" : "naming");
      }
    } finally {
      busy.current = false;
    }
  }, [attach, code]);

  useEffect(() => {
    alive.current = true;
    void connect();

    return () => {
      alive.current = false;
      roomRef.current?.removeAllListeners();
      roomRef.current?.leave();
      roomRef.current = null;
    };
  }, [connect]);

  /**
   * Trocar de app para mandar o link é o jeito normal de convidar alguém, e o
   * celular responde congelando a aba: o socket morre e o SDK gasta as
   * tentativas dele no vazio. Voltar para a aba é o sinal de que dá para tentar
   * de novo — e é aqui, não num botão, que a mesa precisa se recuperar sozinha.
   */
  useEffect(() => {
    const recover = () => {
      if (document.visibilityState !== "visible") return;
      void connect();
    };
    document.addEventListener("visibilitychange", recover);
    addEventListener("online", recover);
    addEventListener("pageshow", recover);
    return () => {
      document.removeEventListener("visibilitychange", recover);
      removeEventListener("online", recover);
      removeEventListener("pageshow", recover);
    };
  }, [connect]);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 2600);
    return () => clearTimeout(timer);
  }, [notice]);

  const retry = useCallback(() => void connect(), [connect]);

  const leave = useCallback(() => {
    roomRef.current?.leave(true);
    roomRef.current = null;
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
      slap: () => roomRef.current?.send("slap"),
      swap: (targetId) => roomRef.current?.send("swap", { targetId } satisfies SwapMessage),
      emote: (emote) => roomRef.current?.send("emote", { emote } satisfies EmoteMessage),
      restart: () => roomRef.current?.send("restart"),
    }),
    [],
  );

  const onFx = useCallback((handler: (events: FxEvent[]) => void) => {
    const handlers = fxHandlers.current;
    handlers.add(handler);
    return () => handlers.delete(handler);
  }, []);

  const onEmote = useCallback((handler: (event: EmoteEvent) => void) => {
    const handlers = emoteHandlers.current;
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
    retry,
    leave,
    actions,
    onFx,
    onEmote,
  };
}

function joinError(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : String(cause);
  if (/not found|locked|no rooms|full/i.test(message)) {
    return "Sala não encontrada, cheia ou com partida já em andamento.";
  }
  return message || "Não foi possível entrar na sala.";
}
