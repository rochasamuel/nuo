import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  MAX_PLAYERS,
  MIN_PLAYERS,
  RULES,
  type CreateRoomOptions,
  type HouseRules,
} from "@uno/shared";
import { BACK_URL } from "../lib/cards";
import { ROOM_NAME, client } from "../lib/colyseus";
import { setPendingRoom } from "../lib/pendingRoom";
import { navigate } from "../lib/router";
import { loadSetup, saveSession, saveSetup } from "../lib/session";
import { useUi } from "../store/ui";

export function HomeScreen() {
  const playerName = useUi((ui) => ui.playerName);
  const setPlayerName = useUi((ui) => ui.setPlayerName);
  // A mesa nasce como foi a última: quem joga sempre com as mesmas regras não
  // remarca as mesmas caixas toda semana. Lido uma vez, na montagem.
  const [setup] = useState(loadSetup);
  const [roomName, setRoomName] = useState(setup.roomName);
  const [maxPlayers, setMaxPlayers] = useState(setup.maxPlayers);
  const [rules, setRules] = useState<HouseRules>(setup.rules);
  const [code, setCode] = useState("");

  const createRoom = useMutation({
    mutationFn: async (options: CreateRoomOptions) => {
      const room = await client.create(ROOM_NAME, options);
      saveSession(room.roomId, {
        reconnectionToken: room.reconnectionToken,
        playerName: options.playerName,
      });
      // Depois de a sala existir, e não no envio: o que se guarda é um
      // combinado que deu certo, não uma tentativa.
      saveSetup({
        roomName: options.roomName,
        maxPlayers: options.maxPlayers,
        rules: options.rules,
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
        alt="NUO"
        className="uno-card mx-auto"
        style={{ width: 132 }}
      />

      <form
        className="px-slab flex flex-col gap-4 p-5"
        onSubmit={(event) => {
          event.preventDefault();
          createRoom.mutate({ roomName, playerName, maxPlayers, rules });
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

        {/* O que se combina antes de repartir. Vale para a mesa inteira e não
            muda depois, então é aqui — e não no lobby — que se decide. */}
        <fieldset className="flex flex-col gap-2">
          <legend className="px-label mb-2">Regras da casa</legend>
          {RULES.map(({ key, label, hint }) => (
            <label key={key} className="flex cursor-pointer items-start gap-2">
              <input
                type="checkbox"
                checked={rules[key]}
                onChange={(event) =>
                  setRules((current) => ({ ...current, [key]: event.target.checked }))
                }
                className="mt-1 size-4 shrink-0"
                style={{ accentColor: "var(--mark)" }}
              />
              <span className="flex flex-col">
                <span className="text-sm" style={{ color: "var(--paper-hi)" }}>
                  {label}
                </span>
                <span className="text-xs" style={{ color: "var(--paper-sh)" }}>
                  {hint}
                </span>
              </span>
            </label>
          ))}
        </fieldset>

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

      {/*
        O crédito fecha a porta de entrada, e mora só aqui: na mesa ele
        disputaria o canto com a vez de alguém, e a mesa é para jogar. No tom
        mais apagado da folha — quem vem abrir uma partida não veio ler um
        nome, mas quem for procurar acha.
      */}
      <footer className="px-label flex flex-wrap items-baseline justify-center gap-x-2">
        <span>desenvolvido por</span>
        <a
          className="px-link px-credit"
          href="https://github.com/rochasamuel"
          target="_blank"
          rel="noopener noreferrer"
        >
          Samuel Rocha ↗
        </a>
      </footer>
    </main>
  );
}
