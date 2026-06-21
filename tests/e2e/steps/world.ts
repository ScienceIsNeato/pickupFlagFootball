import { test as base, createBdd } from "playwright-bdd";

/** Per-scenario scratch space carried between steps. */
export type World = { email?: string; confirmLink?: string };

export const test = base.extend<{ world: World }>({
  world: async ({}, use) => {
    await use({});
  },
});

export const { Given, When, Then, Before, AfterStep } = createBdd(test);
