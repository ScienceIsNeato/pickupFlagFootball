import { scenario } from "../harness/registry";
import { tick } from "@/lib/mime/engine";
import { games, gameRoster, formationAttempts } from "@/lib/db/schema";
import type { EngineDb } from "@/lib/mime/engine";

/**
 * Recovery guard: if a window closer fails after claiming its attempt, it must
 * revert the claim (and drop any partial writes) so the attempt doesn't wedge in
 * COMPILING/ADJUDICATING — a state tick never closes and that blocks new sparks
 * via uq_one_live_attempt. The very next tick must then schedule cleanly.
 */

// A db proxy that throws when inserting into `failTable`, to simulate a failure
// partway through scheduling (here: after the game row, on the roster insert).
function failingOn(realDb: unknown, failTable: unknown): EngineDb {
  return new Proxy(realDb as object, {
    get(target, prop, recv) {
      if (prop === "insert") {
        return (table: unknown) => {
          if (table === failTable) throw new Error("injected failure mid-schedule");
          return (target as { insert: (t: unknown) => unknown }).insert(table);
        };
      }
      const v = Reflect.get(target, prop, recv);
      return typeof v === "function" ? v.bind(target) : v;
    },
  }) as unknown as EngineDb;
}

scenario(
  "recovery — a closer that fails after claiming reverts, then the next tick schedules",
  "an injected mid-schedule failure leaves no wedged attempt and no orphan game; the retry succeeds",
  async (sim) => {
    const dana = await sim.participant("Dana", { zip: "52241" });

    await sim.beat("open availability with a winning option", async () => {
      await sim.interest([dana, ...(await sim.people(7, { zip: "52241" }))]);
      await sim.evaluate("52241");
      await sim.suggest(dana, "City Park", sim.at("Sun 10:00"));
      sim.clock.advance("48h");
      await sim.tick();
      await sim.promise(6, "City Park");
      await sim.expect.attempt().status("AVAILABILITY");
    });

    sim.clock.advance("48h"); // availability due
    await sim.beat("tick fails mid-schedule → attempt reverts, no orphan game", async () => {
      const edb = failingOn(sim.database, gameRoster);
      let threw = false;
      try { await tick(edb, sim.clock.now()); } catch { threw = true; }
      if (!threw) throw new Error("expected the injected failure to surface");

      const [att] = await sim.database.select({ status: formationAttempts.status }).from(formationAttempts);
      if (att.status !== "AVAILABILITY") throw new Error(`wedged in ${att.status}, expected AVAILABILITY`);
      const orphanGames = await sim.database.select().from(games);
      if (orphanGames.length !== 0) throw new Error(`left ${orphanGames.length} orphan game(s)`);
    });

    await sim.beat("the next clean tick schedules normally — no wedge", async () => {
      await sim.tick();
      await sim.expect.area("52241").status("SCHEDULED");
      await sim.expect.game().place("City Park").roster(6);
    }, { participant: "inbox: “game on” — recovered without a hitch" });
  }
);
