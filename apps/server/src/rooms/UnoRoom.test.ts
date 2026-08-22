import { boot, type ColyseusTestServer } from "@colyseus/testing";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import appConfig from "../app.config.js";
import type { UnoRoom } from "./UnoRoom.js";

let colyseus: ColyseusTestServer;

beforeAll(async () => {
  colyseus = await boot(appConfig, 2568);
});
afterAll(() => colyseus.shutdown());
afterEach(() => colyseus.cleanup());

/** Uma sala com gente dentro, e o silêncio depois de todo mundo sentar. */
async function seated(count: number, rules: Record<string, boolean> = {}) {
  const room = await colyseus.createRoom<UnoRoom>("uno", { roomName: "Mesa", rules });
  const clients = [];
  for (let i = 0; i < count; i++) {
    clients.push(await colyseus.connectTo(room, { playerName: `P${i}` }));
  }
  // O `sync` da última entrada ainda está a caminho: esperá-lo aqui é o que
  // impede um `hand` de boas-vindas de passar por resposta a uma recusa.
  await room.waitForNextPatch();
  return { room, clients };
}

describe("uma ação recusada", () => {
  /*
   * O buraco que travou uma mesa de verdade: a recusa saía sozinha, sem estado
   * atrás dela. Quem tivesse divergido do servidor — por um patch perdido, uma
   * aba congelada, o que for — ficava preso olhando uma tela que não existia
   * mais, porque nada no jogo voltava a escrever nela.
   */
  it("reescreve a mesa de quem tentou", async () => {
    const { clients } = await seated(3);
    const notHost = clients[1];

    const corrected = notHost.waitForMessage("hand", 1000);
    const refused = notHost.waitForMessage("error", 1000);
    notHost.send("start");

    await expect(refused).resolves.toMatchObject({ message: /Apenas o host/ });
    await expect(corrected).resolves.toBeDefined();
  });

  it("não reescreve a mesa de quem não tentou nada", async () => {
    const { clients } = await seated(3);

    const quiet = clients[2].waitForMessage("hand", 400);
    clients[1].send("start");
    await clients[1].waitForMessage("error", 1000);

    await expect(quiet).rejects.toBeDefined();
  });
});

describe("um pedido de resync", () => {
  /*
   * A aba que voltou do congelamento não tem como saber o que perdeu, e o
   * servidor não tem como saber que ela congelou. Perguntar é a única saída, e
   * ela não pode custar nada a quem não perguntou.
   */
  it("reescreve a mesa de quem pediu, e só dele", async () => {
    const { clients } = await seated(3);

    const asked = clients[0].waitForMessage("hand", 1000);
    const quiet = clients[1].waitForMessage("hand", 400);
    clients[0].send("resync");

    await expect(asked).resolves.toBeDefined();
    await expect(quiet).rejects.toBeDefined();
  });
});
