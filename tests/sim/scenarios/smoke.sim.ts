import { scenario } from "../harness/registry";

/**
 * Harness self-check — runs today, with no engine. Proves the whole pipeline:
 * pglite loads db/schema.sql, the geo path (zip → centroid → H3 → area) works
 * in-process, interest accumulates, expectations query real SQL, and each beat
 * snapshots the world into the report.
 */
scenario(
  "smoke — interest accrues in an area",
  "harness check: zip → H3 → area, interest accumulates, world snapshots correctly (no engine yet)",
  async (sim) => {
    const dana = await sim.participant("Dana", { zip: "52241" });

    await sim.beat("Dana + 2 neighbors show interest", async () => {
      await sim.interest([dana, ...(await sim.people(2, { zip: "52241" }))]);
      await sim.expect.area("52241").status("DORMANT").interest(3);
    });

    await sim.beat("4 more — 7 interested, still under spark", async () => {
      await sim.interest(await sim.people(4, { zip: "52241" }));
      await sim.expect.area("52241").status("DORMANT").interest(7);
    });

    sim.clock.advance("48h");
    await sim.beat(
      "time passes — without the engine, nothing transitions",
      async () => {
        await sim.expect.area("52241").status("DORMANT").interest(7);
      },
      { participant: "dashboard: “you're among the first”" }
    );
  }
);
