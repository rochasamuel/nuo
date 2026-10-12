import { boot, type ColyseusTestServer } from "@colyseus/testing";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { RECONNECT_TIMEOUT } from "@uno/shared";
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

/*
 * A queda que chega como saída. O Colyseus manda para o `onLeave` tanto quem
 * apertou "sair" quanto quem simplesmente sumiu — e tratar os dois igual
 * matava a cadeira em segundos, e não nos 90s prometidos: a pessoa minimizava
 * o navegador, voltava, e a mesa já não a conhecia.
 */
describe("uma queda que chega pelo caminho da saída", () => {
  it("guarda a cadeira em vez de matá-la", async () => {
    const { room } = await dealt(3);
    const caindo = room.clients[2];

    // Exatamente o que o framework faz quando o socket morre sem consentimento.
    await (room as unknown as { onLeave: (c: unknown, code: number) => Promise<void> })
      .onLeave(caindo, 1001);

    expect([...room.state.players].map((p) => p.name)).toEqual(["P0", "P1", "P2"]);
    expect(room.state.players[2].connected).toBe(false);
    expect(room.state.phase).toBe("playing");
  });

  it("tira a cadeira de quem saiu de propósito", async () => {
    const { room } = await dealt(3);
    const saindo = room.clients[2];

    // 4000 = CONSENTED: o botão "voltar ao início", e não uma queda.
    await (room as unknown as { onLeave: (c: unknown, code: number) => Promise<void> })
      .onLeave(saindo, 4000);

    expect([...room.state.players].map((p) => p.name)).toEqual(["P0", "P1"]);
  });
});

describe("uma queda no meio da entrada", () => {
  /*
   * Toda (re)conexão passa por uma janela em que o servidor espera o cliente
   * confirmar a entrada. Uma queda ali faz o `allowReconnection` recusar na
   * hora ("not joined") — e a recusa não pode valer como prazo vencido. Numa
   * conexão de outro continente essa janela é uma ida e volta inteira.
   */
  it("guarda a cadeira mesmo quando o framework recusa a reserva", async () => {
    const room = await colyseus.createRoom<UnoRoom>("uno", { roomName: "Mesa" });
    await colyseus.connectTo(room, { playerName: "Ana", seatKey: "chave-ana" });
    await colyseus.connectTo(room, { playerName: "Bruno", seatKey: "chave-bruno" });
    const { game, sync } = engine(room);
    game.start();
    sync();

    // O cliente de volta ao estado de "ainda não confirmou a entrada".
    const bruno = room.clients[1] as unknown as { _enqueuedMessages?: unknown[] };
    bruno._enqueuedMessages = [];
    const hooks = room as unknown as {
      onDrop: (c: unknown, code: number) => void;
      onLeave: (c: unknown, code: number) => Promise<void>;
    };
    hooks.onDrop(bruno, 1006);
    await new Promise((done) => setTimeout(done, 50));
    await hooks.onLeave(bruno, 1006);

    expect([...room.state.players].map((p) => p.name)).toEqual(["Ana", "Bruno"]);
    expect(room.state.players[1].connected).toBe(false);

    // E a chave continua abrindo a cadeira.
    await colyseus.connectTo(room, { playerName: "Bruno", seatKey: "chave-bruno" });
    expect(room.state.players.length).toBe(2);
    expect(room.state.players[1].connected).toBe(true);
    // A cadeira deixou de esperar: o timer some do assento.
    expect(room.state.players[1].away).toBe(0);
  });

  it("publica quanto falta para a cadeira morrer", async () => {
    const { room } = await dealt(2);

    await (room as unknown as { onLeave: (c: unknown, code: number) => Promise<void> })
      .onLeave(room.clients[1], 1006);

    expect(room.state.players[1].away).toBe(RECONNECT_TIMEOUT);
    expect(room.state.players[0].away).toBe(0);
  });
});

describe("a volta de quem caiu", () => {
  /** Derruba o socket sem consentimento, que é o que uma queda de verdade faz. */
  async function drop(client: { connection: { transport: { ws: { close: () => void } } } }) {
    client.connection.transport.ws.close();
    await new Promise((done) => setTimeout(done, 600));
  }

  it("devolve a cadeira e a mão a quem volta com a chave, sem o token", async () => {
    const room = await colyseus.createRoom<UnoRoom>("uno", { roomName: "Mesa" });
    const ana = await colyseus.connectTo(room, { playerName: "Ana", seatKey: "chave-ana" });
    const bruno = await colyseus.connectTo(room, { playerName: "Bruno", seatKey: "chave-bruno" });
    const { game, sync } = engine(room);
    game.start();
    sync();
    await Promise.all([ana, bruno].map((c) => c.waitForMessage("hand", 1000)));
    const antes = game.players.find((p) => p.name === "Bruno")!.hand.map((c) => c.id);

    await drop(bruno);
    expect(room.state.players.length).toBe(2);

    // A aba nova: sem token nenhum, só a chave que o navegador guardou.
    const devolta = await colyseus.connectTo(room, { playerName: "Bruno", seatKey: "chave-bruno" });
    const mao = await devolta.waitForMessage("hand", 1000);

    expect(room.state.players.length).toBe(2);
    expect([...room.state.players].map((p) => p.name)).toEqual(["Ana", "Bruno"]);
    expect(mao.cards.map((c: { id: string }) => c.id)).toEqual(antes);
    expect(room.state.players.find((p) => p.name === "Bruno")!.connected).toBe(true);
  });

  it("não deixa um estranho sentar no meio da partida", async () => {
    const room = await colyseus.createRoom<UnoRoom>("uno", { roomName: "Mesa" });
    await colyseus.connectTo(room, { playerName: "Ana", seatKey: "chave-ana" });
    await colyseus.connectTo(room, { playerName: "Bruno", seatKey: "chave-bruno" });
    const { game, sync } = engine(room);
    game.start();
    sync();

    await expect(
      colyseus.connectTo(room, { playerName: "Estranho", seatKey: "chave-estranho" }),
    ).rejects.toThrow(/já começou/);
    expect(room.state.players.length).toBe(2);
  });

  it("recusa a chave de quem continua sentado: cadeira não se rouba", async () => {
    const room = await colyseus.createRoom<UnoRoom>("uno", { roomName: "Mesa" });
    await colyseus.connectTo(room, { playerName: "Ana", seatKey: "chave-ana" });
    await colyseus.connectTo(room, { playerName: "Bruno", seatKey: "chave-bruno" });
    const { game, sync } = engine(room);
    game.start();
    sync();

    // Bruno não caiu: a chave dele não abre nada.
    await expect(
      colyseus.connectTo(room, { playerName: "Ladrão", seatKey: "chave-bruno" }),
    ).rejects.toThrow(/em outra aba/);
    expect(room.state.players.length).toBe(2);
  });
});
