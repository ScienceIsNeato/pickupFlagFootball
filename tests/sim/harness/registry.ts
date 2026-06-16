import type { Sim } from "./sim";

export type ScenarioBody = (sim: Sim) => Promise<void>;

export type Registered = {
  name: string;
  intent: string;
  body: ScenarioBody;
  pending: boolean;
};

const registry: Registered[] = [];

type ScenarioFn = {
  (name: string, intent: string, body: ScenarioBody): void;
  /** Register a scenario as the executable spec for work not yet built. It is
   *  shown gray in the report and its body is never run. Drop `.pending` once
   *  the engine it drives lands. */
  pending: (name: string, intent: string, body: ScenarioBody) => void;
};

export const scenario: ScenarioFn = Object.assign(
  (name: string, intent: string, body: ScenarioBody) => {
    registry.push({ name, intent, body, pending: false });
  },
  {
    pending: (name: string, intent: string, body: ScenarioBody) => {
      registry.push({ name, intent, body, pending: true });
    },
  }
);

export function registered(): Registered[] {
  return registry;
}
