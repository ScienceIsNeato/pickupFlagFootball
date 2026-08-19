"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * The chat tab inside a game / proposal popup. Polls rather than holding a socket
 * open: an SSE stream costs ~3,600 vCPU-s per viewer-hour against Cloud Run's
 * request-seconds billing, versus ~39 for a 7s poll. Polling pauses when the tab is
 * hidden so a forgotten background tab isn't a standing bill.
 *
 * See docs/design/game-chat.md §7.
 */

const POLL_MS = 7000;

type Msg = {
  seq: number; body: string; createdAt: string;
  authorId: string | null; author: string;
  captain: boolean; proposer: boolean;
};

type Feed = {
  ok: boolean; reason?: string; threadId: string | null;
  version: number; locked: boolean; canWrite: boolean; viewerId?: string;
  messages: Msg[]; tombstones: number[];
};

const WHY: Record<string, string> = {
  unverified: "confirm your email to see this game's chat.",
  ineligible: "this chat is for people who play here.",
  notfound: "this chat isn't available.",
};

function ago(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

export function ChatPanel({ gameId, attemptId, isProposal }: {
  gameId?: string; attemptId?: string; isProposal?: boolean;
}) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "blocked">("loading");
  const [reason, setReason] = useState<string>("");
  const [locked, setLocked] = useState(false);
  const [canWrite, setCanWrite] = useState(false);
  const [text, setText] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [viewerId, setViewerId] = useState<string | null>(null);
  // Cursors: seq for new messages, a wall-clock mark for deletions (which land
  // BELOW the seq cursor and would otherwise never reach an open panel).
  const cursor = useRef(0);
  const since = useRef<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const qs = gameId ? `gameId=${gameId}` : `attemptId=${attemptId}`;

  const poll = useCallback(async () => {
    try {
      const u = `/api/chat?${qs}&after=${cursor.current}` +
        (since.current ? `&since=${encodeURIComponent(since.current)}` : "");
      const r = await fetch(u, { cache: "no-store" });
      if (!r.ok) return;
      const d = (await r.json()) as Feed;
      if (!d.ok) { setState("blocked"); setReason(d.reason ?? "notfound"); return; }
      setState("ready");
      if (d.viewerId) setViewerId(d.viewerId);
      setLocked(d.locked);
      setCanWrite(d.canWrite);
      if (d.tombstones.length) {
        const gone = new Set(d.tombstones);
        setMsgs((prev) => prev.filter((m) => !gone.has(m.seq)));
      }
      if (d.messages.length) {
        cursor.current = d.messages[d.messages.length - 1].seq;
        setMsgs((prev) => {
          const seen = new Set(prev.map((m) => m.seq));
          return [...prev, ...d.messages.filter((m) => !seen.has(m.seq))];
        });
      }
      since.current = new Date().toISOString();
    } catch {
      // A dropped poll is not an error state — the next tick recovers.
    }
  }, [qs]);

  // Poll while mounted and visible. Marking read on mount is what clears the dot.
  useEffect(() => {
    let alive = true;
    void poll();
    void fetch("/api/chat", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "read", gameId, attemptId }),
    }).catch(() => {});
    const id = setInterval(() => {
      if (alive && document.visibilityState === "visible") void poll();
    }, POLL_MS);
    const onVis = () => { if (document.visibilityState === "visible") void poll(); };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      alive = false;
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [poll, gameId, attemptId]);

  // Keep the newest message in view as things arrive.
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [msgs.length]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true); setErr("");
    try {
      const r = await fetch("/api/chat", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ gameId, attemptId, body }),
      });
      const d = (await r.json()) as { ok: boolean; reason?: string };
      if (!d.ok) {
        setErr(d.reason === "ratelimited" ? "slow down - 5 messages a minute."
          : d.reason === "toolong" ? "too long. keep it under 1000 characters."
          : "couldn't send that. try again.");
        return;
      }
      setText("");
      await poll();
    } catch {
      setErr("couldn't send that. try again.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(seq: number) {
    // Confirm with the server BEFORE hiding it. Removing optimistically would be a
    // one-way door: the poll only asks for seqs above the cursor, so a rejected or
    // failed delete could never bring the message back while the panel stayed open.
    try {
      const r = await fetch("/api/chat", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "delete", gameId, attemptId, seq }),
      });
      const d = (await r.json()) as { ok: boolean };
      if (!d.ok) { setErr("couldn't delete that."); return; }
      setMsgs((prev) => prev.filter((m) => m.seq !== seq));
    } catch {
      setErr("couldn't delete that.");
    }
    await poll();
  }

  if (state === "loading") return <p className="game-muted chat-empty">loading…</p>;
  if (state === "blocked") return <p className="game-muted chat-empty">{WHY[reason] ?? WHY.notfound}</p>;

  return (
    <div className="chat">
      <p className="chat-who">
        anyone on the roster, the captains, anyone who said they&apos;re in, and confirmed
        players close enough to play here can read this.
      </p>

      {msgs.length === 0 ? (
        <p className="chat-empty">
          nothing here yet. start it off - where to park, what to bring, what time
          you&apos;re actually showing up.
        </p>
      ) : (
        <div className="chat-thread" ref={listRef}>
          {msgs.map((m) => (
            <div className="chat-msg" key={m.seq}>
              <div className="chat-msg-h">
                <span className="chat-nm">{m.author}</span>
                {m.captain && <span className="chat-tag chat-tag-cap">captain</span>}
                {m.proposer && <span className="chat-tag chat-tag-prop">proposed this</span>}
                <span className="chat-when">{ago(m.createdAt)}</span>
              </div>
              <p className="chat-txt">{m.body}</p>
              {m.authorId && m.authorId === viewerId && canWrite && (
                <button type="button" className="chat-del" onClick={() => remove(m.seq)}>delete</button>
              )}
            </div>
          ))}
        </div>
      )}

      {isProposal && (
        <div className="chat-note chat-note-warn">
          <b>heads up</b>
          people who said &quot;i&apos;m in&quot; by email won&apos;t see this unless they come back to
          the map, or have chat emails turned on.
        </div>
      )}

      {locked ? (
        <div className="chat-note"><b>a captain locked this thread</b>you can still read it.</div>
      ) : canWrite ? (
        <form className="chat-comp" onSubmit={send}>
          <textarea
            value={text} onChange={(e) => setText(e.target.value)} maxLength={1000}
            placeholder="say something - parking, gear, who's bringing a ball"
            aria-label="your message"
          />
          <button type="submit" className="chat-send" disabled={busy || !text.trim()}>send</button>
        </form>
      ) : (
        <div className="chat-note"><b>confirm your email to post</b>you can read without it.</div>
      )}
      {err && <p className="chat-err" role="alert">{err}</p>}
    </div>
  );
}
