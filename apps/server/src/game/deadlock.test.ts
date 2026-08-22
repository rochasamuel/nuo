import { describe, expect, it } from "vitest";
import { RULES, type HouseRules } from "@uno/shared";
import { UnoGame } from "./UnoGame.js";

/**
 * A propriedade que nenhum teste de caso cobre: em QUALQUER posição alcançável,
 * quem tem a vez consegue sair dela.
 *
 * Uma mesa de UNO só trava de um jeito — o jogo parar esperando alguém que não
 * tem o que fazer —, e é um jeito que não aparece em teste de cenário, porque
 * ninguém escreve o cenário que não imaginou. Então joga-se muito: todas as
 * combinações de regras, mesas de dois a cinco, com gente caindo no meio.
 */

function seeded(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const COLORS = ["red", "green", "blue", "yellow"] as const;
const MAX_TURNS = 4000;

type Fault = { seed: number; players: number; rules: string; why: string; position: string };

/**
 * Joga uma partida inteira e devolve a primeira posição impossível, se houver.
 *
 * As duas mesas congeladas — o tapa e a troca — se resolvem pelo prazo, que é o
 * que a sala faz por timer. Sem isso a partida ficaria parada por regra, e não
 * por defeito.
 */
function play(seed: number, rules: Partial<HouseRules>, players: number): Fault | null {
  const random = seeded(seed);
  const game = new UnoGame(random);
  game.rules = { ...game.rules, ...rules };
  for (let i = 0; i < players; i++) game.addPlayer(`p${i}`, `P${i}`);
  game.start();

  const label = { seed, players, rules: JSON.stringify(rules) };

  for (let turn = 0; turn < MAX_TURNS && game.phase === "playing"; turn++) {
    if (game.slapPending.length > 0) {
      game.timeoutSlap();
      continue;
    }
    if (game.swapChooserId !== "") {
      game.timeoutSwap();
      continue;
    }

    // O celular que congela no meio da partida é o caso real; aqui ele é raro
    // de propósito, para não desmanchar a mesa antes de ela ser interessante.
    if (players > 2 && random() < 0.01) {
      game.removePlayer(game.players[Math.floor(random() * game.players.length)].id);
      continue;
    }

    const me = game.currentPlayer!;
    const playable = game.playableCards(me.id);
    const position = JSON.stringify({
      turn,
      pendingDraw: game.pendingDraw,
      drawnCardId: game.drawnCardId,
      top: game.discard.at(-1),
      currentColor: game.currentColor,
      hand: me.hand,
      deck: game.deck.length,
    });

    /*
     * O que o servidor aceita como compra, escrito aqui de fora, contra o que a
     * mesa oferece — é o `disabled` do monte em Table.tsx, ao pé da letra.
     * Divergir significa botão apagado numa compra legítima: quem joga não tem
     * como saber que só faltou insistir, e a mesa inteira para junto.
     */
    const frozen = game.slapPending.length > 0 || game.swapChooserId !== "";
    const tableOffers = !frozen && !(game.pendingDraw === 0 && playable.length > 0);
    const serverTakes =
      !frozen &&
      (game.pendingDraw > 0 || (game.drawnCardId === null && playable.length === 0));
    if (serverTakes && !tableOffers) {
      return { ...label, why: "o monte fica apagado numa compra que o servidor aceita", position };
    }

    if (playable.length > 0 && random() < 0.8) {
      const chosen = playable[Math.floor(random() * playable.length)];
      try {
        game.playCard(me.id, chosen.id, COLORS[Math.floor(random() * COLORS.length)]);
      } catch (cause) {
        return { ...label, why: `recusou uma carta que ofereceu: ${(cause as Error).message}`, position };
      }
      continue;
    }

    try {
      game.drawCard(me.id);
      continue;
    } catch (drawn) {
      try {
        game.pass(me.id);
        continue;
      } catch (passed) {
        // Ter jogada e não querer usá-la não é estar travado.
        if (playable.length > 0) continue;
        return {
          ...label,
          why: `sem jogada, comprar="${(drawn as Error).message}", passar="${(passed as Error).message}"`,
          position,
        };
      }
    }
  }

  return null;
}

/** Todas as combinações de regras: cada uma é um bit, e a lista é a contagem. */
function everyRuleset(): Partial<HouseRules>[] {
  const keys = RULES.map((rule) => rule.key);
  return Array.from({ length: 1 << keys.length }, (_, mask) =>
    Object.fromEntries(keys.map((key, bit) => [key, (mask & (1 << bit)) !== 0])),
  );
}

describe("uma mesa nunca trava", () => {
  it("deixa sempre uma saída para quem tem a vez", () => {
    const faults: Fault[] = [];

    for (const rules of everyRuleset()) {
      for (let players = 2; players <= 5; players++) {
        for (let seed = 1; seed <= 25; seed++) {
          const fault = play(seed, rules, players);
          if (fault) {
            faults.push(fault);
            break; // uma amostra por combinação basta para a mensagem
          }
        }
      }
    }

    expect(faults).toEqual([]);
  });
});
