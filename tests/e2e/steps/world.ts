import { test as base, createBdd } from "playwright-bdd";

/** Per-scenario scratch space carried between steps. */
export type World = {
  email?: string;
  confirmLink?: string;
  game?: { lat: number; lng: number; placeText: string; gameId?: string; areaId?: string };
  // captured to assert a captain action changed the popup (e.g. cancel advances "next game")
  nextGameCaption?: string;
  rsvpToken?: string; // signed one-click RSVP-link token for the email-link flow
  attemptId?: string; // the live formation attempt, for the formation-FSM e2e
  occurrenceId?: string; // the weekly occurrence row, for the occurrence-FSM e2e
};

export const test = base.extend<{ world: World }>({
  world: async ({}, use) => {
    await use({});
  },
});

export const { Given, When, Then, Before, AfterStep } = createBdd(test);
