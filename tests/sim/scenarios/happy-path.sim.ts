import { scenario } from "../harness/registry";

/**
 * The full formation loop, end to end. PENDING until the engine lands (Phase 5)
 * — this file is the executable spec the engine must satisfy. Drop `.pending`
 * once sim.evaluate()/sim.tick() drive the real lib/mime + cron handlers.
 */
scenario.pending(
  "happy path — Coralville sparks and schedules",
  "eight interested residents in 52241; one game scheduled at City Park",
  async (sim) => {
    const dana = await sim.participant("Dana", { zip: "52241" });

    await sim.beat("Coralville dormant — 3 residents interested", async () => {
      await sim.interest([dana, ...(await sim.people(2, { zip: "52241" }))]);
      await sim.expect.area("52241").status("DORMANT").interest(3);
    });

    await sim.beat("4 more interested — 7 total, area warms", async () => {
      await sim.interest(await sim.people(4, { zip: "52241" }));
      await sim.expect.area("52241").status("DORMANT");
    });

    await sim.beat("8th interest → evaluate() sparks formation", async () => {
      await sim.interest(await sim.people(1, { zip: "52241" }));
      await sim.evaluate("52241");
      await sim.expect.area("52241").status("IN_FORMATION");
      await sim.expect.attempt().status("SUGGESTING");
      await sim.expect.outbox().kind("SPARK_ASK").sentTo(8).oncePerUser();
    }, { participant: "inbox: “enough folks nearby — suggest a place & time?”" });

    await sim.beat("Dana suggests City Park, Sun 10am", async () => {
      await sim.suggest(dana, "City Park", sim.at("Sun 10:00"));
      await sim.expect.attempt().suggestions(1);
    }, { participant: "“your suggestion is in”" });

    await sim.beat("Eve suggests Rec Center, Sat 9am", async () => {
      const eve = await sim.participant("Eve", { zip: "52241" });
      await sim.suggest(eve, "Rec Center", sim.at("Sat 09:00"));
      await sim.expect.attempt().suggestions(2);
    });

    sim.clock.advance("48h");
    await sim.beat("⏰ tick — suggestion closes → compile → availability opens", async () => {
      await sim.tick();
      await sim.expect.attempt().status("AVAILABILITY").options(2);
      await sim.expect.outbox().kind("OPTIONS_AVAILABLE").sentTo(8);
    }, { participant: "inbox: “which would you show up for?”" });

    await sim.beat("6 promise City Park · 2 promise Rec Center", async () => {
      await sim.promise(6, "City Park");
      await sim.promise(2, "Rec Center");
      await sim.expect.option("City Park").promises(6);
    }, { participant: "“you're in if it's on”" });

    sim.clock.advance("48h");
    await sim.beat("⏰ tick — availability closes → adjudicate → City Park wins (6 ≥ p_min)", async () => {
      await sim.tick();
      await sim.expect.area("52241").status("SCHEDULED");
      await sim.expect.game().place("City Park").roster(6);
      await sim.expect.outbox().kind("GAME_ON").sentTo(6).oncePerUser();
    }, { participant: "inbox: “game on — Sun 10am, City Park”" });
  }
);
