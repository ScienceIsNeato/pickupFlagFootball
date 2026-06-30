import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { notifySlack, slackNewPlayer, slackProposed, notifyResolve } from "@/lib/slack";

const HOOK = "https://hooks.slack.test/x";
function captureFetch() {
  return mock.method(globalThis, "fetch", async () => new Response("ok"));
}
function postedText(f: ReturnType<typeof captureFetch>): string {
  const opts = f.mock.calls[0].arguments[1] as { body: string };
  return JSON.parse(opts.body).text as string;
}

test("notifySlack no-ops (no fetch) when SLACK_WEBHOOK_URL is unset", () => {
  delete process.env.SLACK_WEBHOOK_URL;
  const f = captureFetch();
  notifySlack("hello");
  assert.equal(f.mock.callCount(), 0, "must not post without a webhook");
  f.mock.restore();
});

test("notifySlack posts to the webhook when set, and never throws on failure", () => {
  process.env.SLACK_WEBHOOK_URL = HOOK;
  const f = mock.method(globalThis, "fetch", async () => { throw new Error("network down"); });
  assert.doesNotThrow(() => notifySlack("hi")); // fire-and-forget: a failure can't break the caller
  assert.equal(f.mock.callCount(), 1);
  f.mock.restore();
  delete process.env.SLACK_WEBHOOK_URL;
});

test("slackNewPlayer formats who + where", () => {
  process.env.SLACK_WEBHOOK_URL = HOOK;
  const f = captureFetch();
  slackNewPlayer({ displayName: "Sam Spark", email: "sam@x.com", city: "Austin", zip: "78701" });
  assert.match(postedText(f), /new player/i);
  assert.match(postedText(f), /Sam Spark/);
  assert.match(postedText(f), /Austin \(78701\)/);
  f.mock.restore();
  delete process.env.SLACK_WEBHOOK_URL;
});

test("slackProposed shows the street line, when, and window", () => {
  process.env.SLACK_WEBHOOK_URL = HOOK;
  const f = captureFetch();
  slackProposed({ place: "Republic Square, Austin 78701 — east lot", when: "Saturdays 10:00", closesInH: 48 });
  const t = postedText(f);
  assert.match(t, /Republic Square, Austin 78701/);
  assert.doesNotMatch(t, /east lot/); // notes dropped — street line only
  assert.match(t, /Saturdays 10:00/);
  assert.match(t, /48h/);
  f.mock.restore();
  delete process.env.SLACK_WEBHOOK_URL;
});

test("notifyResolve formats formed vs stalled", () => {
  process.env.SLACK_WEBHOOK_URL = HOOK;
  let f = captureFetch();
  notifyResolve({ kind: "formed", place: "Republic Square — notes", count: 7 });
  assert.match(postedText(f), /game formed.*Republic Square.*7 players in/i);
  f.mock.restore();

  f = captureFetch();
  notifyResolve({ kind: "stalled", place: "Republic Square", count: 3, pMin: 6 });
  assert.match(postedText(f), /stalled.*Republic Square.*3\/6/i);
  f.mock.restore();
  delete process.env.SLACK_WEBHOOK_URL;
});
