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

// These tests mutate shared global state (process.env.SLACK_WEBHOOK_URL and
// globalThis.fetch); each wraps its assertions in try/finally so a failure can't
// leak the mock/env into later tests.

test("notifySlack no-ops (no fetch) when SLACK_WEBHOOK_URL is unset", () => {
  delete process.env.SLACK_WEBHOOK_URL;
  const f = captureFetch();
  try {
    notifySlack("hello");
    assert.equal(f.mock.callCount(), 0, "must not post without a webhook");
  } finally {
    f.mock.restore();
  }
});

test("notifySlack posts to the webhook when set, and never throws on failure", () => {
  process.env.SLACK_WEBHOOK_URL = HOOK;
  const f = mock.method(globalThis, "fetch", async () => { throw new Error("network down"); });
  try {
    assert.doesNotThrow(() => notifySlack("hi")); // fire-and-forget: a failure can't break the caller
    assert.equal(f.mock.callCount(), 1);
  } finally {
    f.mock.restore();
    delete process.env.SLACK_WEBHOOK_URL;
  }
});

test("slackNewPlayer formats who + where, and never leaks the email", () => {
  process.env.SLACK_WEBHOOK_URL = HOOK;
  const f = captureFetch();
  try {
    slackNewPlayer({ displayName: "Sam Spark", city: "Austin", zip: "78701" });
    const t = postedText(f);
    assert.match(t, /new player/i);
    assert.match(t, /Sam Spark/);
    assert.match(t, /Austin \(78701\)/);
    assert.doesNotMatch(t, /@/, "an email address must never reach the activity feed");
  } finally {
    f.mock.restore();
    delete process.env.SLACK_WEBHOOK_URL;
  }
});

test("slackProposed shows the street line, when, and window", () => {
  process.env.SLACK_WEBHOOK_URL = HOOK;
  const f = captureFetch();
  try {
    slackProposed({ place: "Republic Square, Austin 78701 — east lot", when: "Saturdays 10:00", closesInH: 48 });
    const t = postedText(f);
    assert.match(t, /Republic Square, Austin 78701/);
    assert.doesNotMatch(t, /east lot/); // notes dropped — street line only
    assert.match(t, /Saturdays 10:00/);
    assert.match(t, /48h/);
  } finally {
    f.mock.restore();
    delete process.env.SLACK_WEBHOOK_URL;
  }
});

test("messages escape Slack mrkdwn control chars in user-controlled text", () => {
  process.env.SLACK_WEBHOOK_URL = HOOK;
  const f = captureFetch();
  try {
    slackNewPlayer({ displayName: "<b>Ann</b> & Bo", city: "A<x>", zip: "1&2" });
    const t = postedText(f);
    assert.doesNotMatch(t, /[<>]/, "raw angle brackets must be escaped, not posted");
    assert.match(t, /&lt;b&gt;Ann&lt;\/b&gt; &amp; Bo/);
  } finally {
    f.mock.restore();
    delete process.env.SLACK_WEBHOOK_URL;
  }
});

test("notifyResolve formats formed vs stalled", () => {
  process.env.SLACK_WEBHOOK_URL = HOOK;
  let f = captureFetch();
  try {
    notifyResolve({ kind: "formed", place: "Republic Square — notes", count: 7 });
    assert.match(postedText(f), /game formed.*Republic Square.*7 players in/i);
  } finally {
    f.mock.restore();
  }

  f = captureFetch();
  try {
    notifyResolve({ kind: "stalled", place: "Republic Square", count: 3, pMin: 6 });
    assert.match(postedText(f), /stalled.*Republic Square.*3\/6/i);
  } finally {
    f.mock.restore();
    delete process.env.SLACK_WEBHOOK_URL;
  }
});
