import Link from "next/link";

/** Header links into the app, shown for any signed-in user. Server-rendered
 *  (driven by a prop from the server, not client useSession) so they show
 *  reliably on every page. find-a-game and my-games are available to every
 *  logged-in user regardless of interest or email-confirmation status. */
export function HeaderPlayLink({ loggedIn = false }: { loggedIn?: boolean }) {
  if (!loggedIn) return null;
  return (
    <>
      <Link href="/play" className="nav-play">find a game</Link>
      <Link href="/my-games" className="nav-mine">my games</Link>
    </>
  );
}
