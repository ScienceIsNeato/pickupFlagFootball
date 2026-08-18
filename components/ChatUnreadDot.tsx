"use client";

import { useEffect, useState } from "react";

/**
 * The "someone said something" dot on the map link. With no push and email off by
 * default, in-app unread is the only way a conversation reaches anyone.
 *
 * Deliberately no timer of its own. The map already polls /api/hud every 15s and
 * rebroadcasts the count on this event, so on /play the dot is live; everywhere else
 * a single fetch on mount is enough, since those pages don't sit open watching for
 * chat. A second always-on interval would pay its own auth() DB round trip for a
 * number that is almost always zero.
 */
export const CHAT_UNREAD_EVENT = "mime:chat-unread";

export function ChatUnreadDot() {
  const [n, setN] = useState(0);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const r = await fetch("/api/hud", { cache: "no-store" });
        if (!r.ok) return;
        const d = (await r.json()) as { chatUnread?: number };
        if (alive) setN(d.chatUnread ?? 0);
      } catch {
        // Not worth surfacing — the dot is an affordance, not information the
        // user is waiting on.
      }
    })();
    const onCount = (e: Event) => {
      const v = (e as CustomEvent<number>).detail;
      if (typeof v === "number") setN(v);
    };
    window.addEventListener(CHAT_UNREAD_EVENT, onCount);
    return () => { alive = false; window.removeEventListener(CHAT_UNREAD_EVENT, onCount); };
  }, []);

  if (n <= 0) return null;
  return <span className="chat-dot" aria-label={`${n} unread chat${n === 1 ? "" : "s"}`} />;
}
