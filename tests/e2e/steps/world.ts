import { test as base, createBdd } from "playwright-bdd";

/** Per-scenario scratch space carried between steps. */
export type World = {
  email?: string;
  confirmLink?: string;
  game?: { lat: number; lng: number; placeText: string; gameId?: string; areaId?: string };
  // captured to assert a captain action changed the popup (e.g. cancel advances "next game")
  nextGameCaption?: string;
  attemptId?: string; // the live formation attempt, for the formation-FSM e2e
  occurrenceId?: string; // the weekly occurrence row, for the occurrence-FSM e2e
  // The HUD walkthrough's persistent cohort of real neighbors — created once and
  // reused to back the proposal and roster the games, so the whole story is one
  // honest arc (the interest that accumulates is what actually forms the games).
  cohort?: string[]; // neighbor user ids
  gameId?: string; secondGameId?: string; // the games that form, for roster assertions
  // Report "beat lens": when set (a CSS selector), the AfterStep hook
  // screenshots just that element for this scenario's beats instead of the
  // full page — for stories that are about one widget, not the whole screen.
  beatLens?: string;
};

export const test = base.extend<{ world: World }>({
  world: async ({}, use) => {
    await use({});
  },
});

export const { Given, When, Then, Before, AfterStep } = createBdd(test);
