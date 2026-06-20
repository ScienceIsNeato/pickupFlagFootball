"use client";

import Link from "next/link";
import { useSession } from "next-auth/react";

/** "find a game" header link, shown only when signed in (the marketing header
 *  otherwise has no direct way into the map). "my games" is gated further on
 *  showMine (server-computed: signed in AND has shown interest in an area). */
export function HeaderPlayLink({ showMine = false }: { showMine?: boolean }) {
  const { data: session } = useSession();
  if (!session?.user) return null;
  return (
    <>
      <Link href="/play" className="nav-play">find a game</Link>
      {showMine && <Link href="/my-games" className="nav-mine">my games</Link>}
    </>
  );
}
