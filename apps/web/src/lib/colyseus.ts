import { Client } from "@colyseus/sdk";

const endpoint =
  import.meta.env.VITE_SERVER_URL ?? `${location.protocol}//${location.hostname}:2567`;

export const client = new Client(endpoint);

export const ROOM_NAME = "uno";
