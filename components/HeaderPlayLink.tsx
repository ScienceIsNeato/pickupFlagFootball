"use client";

import Link from "next/link";
import { useSession } from "next-auth/react";

/** "find a game" header link, shown only when signed in (the marketing header
 *  otherwise has no direct way into the map). */
export function HeaderPlayLink() {
  const { data: session } = useSession();
  if (!session?.user) return null;
  return (
    <>
      <Link href="/play" className="nav-play">find a game</Link>
      <Link href="/my-games" className="nav-mine">my games</Link>
    </>
  );
}
