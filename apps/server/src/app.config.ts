import { defineServer, defineRoom } from "colyseus";
import cors from "cors";
import { UnoRoom } from "./rooms/UnoRoom.js";

export default defineServer({
  rooms: {
    uno: defineRoom(UnoRoom),
  },

  // The web app is served from another origin in development, and matchmaking
  // goes over plain HTTP before the WebSocket is opened.
  express: (app) => {
    app.use(cors({ origin: process.env.CORS_ORIGIN ?? true }));
  },
});
