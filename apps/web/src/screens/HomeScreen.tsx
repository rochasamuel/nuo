import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  DEFAULT_MAX_PLAYERS,
  MAX_PLAYERS,
  MIN_PLAYERS,
  type CreateRoomOptions,
} from "@uno/shared";
import { BACK_URL } from "../lib/cards";
import { ROOM_NAME, client } from "../lib/colyseus";
import { setPendingRoom } from "../lib/pendingRoom";
import { navigate } from "../lib/router";
import { saveSession } from "../lib/session";
import { useUi } from "../store/ui";

export function HomeScreen() {
  const playerName = useUi((ui) => ui.playerName);
  const setPlayerName = useUi((ui) => ui.setPlayerName);
  const [roomName, setRoomName] = useState("Sexta-feira UNO");
  const [maxPlayers, setMaxPlayers] = useState(DEFAULT_MAX_PLAYERS);
  const [code, setCode] = useState("");

  const createRoom = useMutation({
    mutationFn: async (options: CreateRoomOptions) => {
      const room = await client.create(ROOM_NAME, options);
      saveSession(room.roomId, {
        reconnectionToken: room.reconnectionToken,
        playerName: options.playerName,
      });
      setPendingRoom(room);
      return room.roomId;
    },
    onSuccess: (roomId) => navigate(`/room/${roomId}`),
  });

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 p-6">
      {/* O logotipo do jogo é a própria carta: o verso já traz a palavra na
          tipografia do baralho, inclinada nos mesmos 25° do oval. */}
      <img
        src={BACK_URL}
        alt="UNO"
        className="uno-card mx-auto"
        style={{ width: 132 }}
      />

      <form
        className="px-slab flex flex-col gap-4 p-5"
        onSubmit={(event) => {
          event.preventDefault();
          createRoom.mutate({ roomName, playerName, maxPlayers });
        }}
      >
        <h1 className="px-title">Abrir uma mesa</h1>

        <label className="flex flex-col gap-1">
          <span className="px-label">Nome da mesa</span>
          <input
            className="px-input"
            value={roomName}
            onChange={(event) => setRoomName(event.target.value)}
            maxLength={40}
            required
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="px-label">Seu nome</span>
          <input
            className="px-input"
            value={playerName}
            onChange={(event) => setPlayerName(event.target.value)}
            maxLength={16}
            required
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="px-label">Lugares na mesa · {maxPlayers}</span>
          <input
            type="range"
            min={MIN_PLAYERS}
            max={MAX_PLAYERS}
            value={maxPlayers}
            onChange={(event) => setMaxPlayers(Number(event.target.value))}
            style={{ accentColor: "var(--mark)" }}
          />
        </label>

        <button
          type="submit"
          disabled={createRoom.isPending}
          className="px-btn px-btn-primary"
        >
          {createRoom.isPending ? "Abrindo…" : "Abrir mesa"}
        </button>
        {createRoom.isError && (
          <p className="px-label" style={{ color: "var(--red)" }}>
            {createRoom.error.message}
          </p>
        )}
      </form>

      <form
        className="flex items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          navigate(`/room/${code.trim().toUpperCase()}`);
        }}
      >
        <label className="flex flex-1 flex-col gap-1">
          <span className="px-label">Entrar com um código</span>
          <input
            className="px-input uppercase"
            placeholder="A7K92"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            maxLength={8}
            required
          />
        </label>
        <button type="submit" className="px-btn">
          Entrar
        </button>
      </form>
    </main>
  );
}
