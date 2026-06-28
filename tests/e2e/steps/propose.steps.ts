import { expect } from "@playwright/test";
import { When, Then } from "./world";
import { proposeAsUser, isAreaCaptain } from "../support/db";

// Reuses "I am a confirmed player …", "I open the game on the map", and the
// formation-FSM steps (suggestion/availability windows, commit, schedule/stall).
const SITE = { lat: 30.281, lng: -97.742, placeText: "Republic Square", city: "Austin", zip: "78701" };

When("I propose a game at a nearby spot", async ({ world }) => {
  const r = await proposeAsUser(world.email!, SITE);
  world.game = { lat: r.lat, lng: r.lng, placeText: r.placeText, areaId: r.areaId };
  world.attemptId = r.attemptId;
});

Then("I am a captain of the proposed site", async ({ world }) => {
  expect(await isAreaCaptain(world.game!.areaId!, world.email!)).toBe(true);
});

// After the formation confirms, the game inherits the area's captains — so the
// proposer is still a captain of the scheduled game.
Then("I am a captain of the scheduled game", async ({ world }) => {
  expect(await isAreaCaptain(world.game!.areaId!, world.email!)).toBe(true);
});
