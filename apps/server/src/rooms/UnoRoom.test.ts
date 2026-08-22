import { boot, type ColyseusTestServer } from "@colyseus/testing";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import appConfig from "../app.config.js";
import type { UnoGame } from "../game/UnoGame.js";
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

/*
 * O descarte e o log não são reescritos a cada jogada: entra o que entrou e sai
 * o que saiu da janela. É mais barato e é mais frágil — um passo errado
 * desalinha as duas listas e nada avisa, porque a mesa continua desenhando com
 * convicção o que recebeu. Estes testes conferem contra a verdade do servidor.
 */
describe("o espelho do descarte e do log", () => {
  /** A partida, começada sem esperar a roleta, e o acesso ao motor por trás. */
  function engine(room: UnoRoom) {
    const inner = room as unknown as { game: UnoGame; sync: () => void };
    return { game: inner.game, sync: () => inner.sync() };
  }

  const ids = (cards: { id: string }[]) => cards.map((card) => card.id);

  it("acompanha jogada a jogada, pelo reembaralhar e pela revanche", async () => {
    const { room, clients } = await seated(3);
    const { game, sync } = engine(room);
    const seen = clients[0];

    const mirrors = async () => {
      sync();
      await room.waitForNextPatch();
      expect(ids([...seen.state.discard])).toEqual(ids(game.discard.slice(-8)));
      expect(seen.state.discardCount).toBe(game.discard.length);
      expect([...seen.state.log]).toEqual(game.log);
    };

    game.start();
    await mirrors();

    // Vinte cartas passando pela janela de oito: o suficiente para ela deslizar
    // várias vezes, e para o log de doze linhas dar a volta.
    for (let i = 0; i < 20; i++) {
      game.discard.push(game.deck.pop()!);
      (game as unknown as { pushLog: (m: string) => void }).pushLog(`linha ${i}`);
      await mirrors();
    }

    // O reembaralhar: o descarte encolhe para uma carta só.
    game.deck.length = 0;
    game.discard.push(game.deck.pop() ?? game.discard[0]);
    (game as unknown as { refill: () => void }).refill();
    await mirrors();

    // A revanche: janela nova, log zerado, e nada da partida anterior sobrando.
    game.phase = "lobby";
    game.start();
    await mirrors();
  });
});

/*
 * A mão só vai para quem tem mão nova. Antes ela ia para todo mundo a cada
 * ação da mesa: uma jogada reescrevia os dez leques, carta por carta na rede,
 * para dizer aos nove que nada tinha mudado no deles.
 */
describe("a mão privada", () => {
  function engine(room: UnoRoom) {
    const inner = room as unknown as { game: UnoGame; sync: () => void };
    return { game: inner.game, sync: () => inner.sync() };
  }

  /** A partida começada na marra, sem os dois segundos e meio da roleta. */
  async function dealt(count: number) {
    const seats = await seated(count);
    const parts = engine(seats.room);
    parts.game.start();
    parts.sync();
    await Promise.all(seats.clients.map((c) => c.waitForMessage("hand", 1000)));
    return { ...seats, ...parts };
  }

  it("cala numa sincronização que não mexeu em mão nenhuma", async () => {
    const { room, clients, sync } = await dealt(3);

    const quiet = clients.map((c) => c.waitForMessage("hand", 400));
    sync();
    await room.waitForNextPatch();

    for (const wait of quiet) await expect(wait).rejects.toBeDefined();
  });

  it("fala com quem acabou de mexer na dele", async () => {
    const { clients, game, sync } = await dealt(3);
    const turn = clients.find((c) => c.sessionId === game.currentPlayer!.id)!;

    const told = turn.waitForMessage("hand", 1000);
    const playable = game.playableCards(turn.sessionId);
    if (playable.length > 0) game.playCard(turn.sessionId, playable[0].id, "red");
    else game.drawCard(turn.sessionId);
    sync();

    await expect(told).resolves.toBeDefined();
  });

  it("responde a um resync mesmo sem nada ter mudado", async () => {
    const { clients } = await dealt(3);

    const asked = clients[1].waitForMessage("hand", 1000);
    clients[1].send("resync");

    await expect(asked).resolves.toBeDefined();
  });
});
