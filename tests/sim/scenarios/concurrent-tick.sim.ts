import { scenario } from "../harness/registry";
import { tick } from "@/lib/mime/engine";
import { games } from "@/lib/db/schema";
import type { EngineDb } from "@/lib/mime/engine";

/**
 * Concurrency guard: two cron ticks that pick up the SAME due window must not
 * both schedule it. Each window closer claims its attempt with an atomic
 * conditional status transition before doing any inserts, so the loser of the
 * race bails instead of creating a second game/roster.
 */
scenario(
  "concurrency — overlapping ticks schedule a window only once",
  "two simultaneous tick() runs on one due AVAILABILITY attempt produce exactly one game",
  async (sim) => {
    const dana = await sim.participant("Dana", { zip: "52241" });

    await sim.beat("spark, suggest, and open availability with enough promises", async () => {
      await sim.interest([dana, ...(await sim.people(7, { zip: "52241" }))]); // 8 → spark
      await sim.evaluate("52241");
      await sim.suggest(dana, "City Park", sim.at("Sun 10:00"));
      sim.clock.advance("48h");
      await sim.tick();                       // suggestion closes → availability opens
      await sim.promise(6, "City Park");       // ≥ p_min → will schedule
      await sim.expect.attempt().status("AVAILABILITY");
    });

    sim.clock.advance("48h"); // availability window now due to close
    await sim.beat("two ticks fire at once → one game, not two", async () => {
      const edb = sim.database as unknown as EngineDb;
      const now = sim.clock.now();
      await Promise.all([tick(edb, now), tick(edb, now)]);
      const rows = await sim.database.select().from(games);
      if (rows.length !== 1) {
        throw new Error(`expected exactly 1 game from concurrent ticks, got ${rows.length}`);
      }
      await sim.expect.area("52241").status("SCHEDULED");
      await sim.expect.game().place("City Park").roster(6);
    }, { participant: "inbox: one “game on”, never a duplicate" });
  }
);
