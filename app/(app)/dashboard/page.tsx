import Link from "next/link";
import { auth } from "@/lib/auth";

export default async function DashboardPage() {
  const session = await auth();
  return (
    <main className="reg">
      <h1 className="reg-h">dashboard</h1>
      <p className="reg-blurb">
        signed in as {session?.user?.email ?? "unknown"}.
      </p>
      <p className="reg-blurb">
        next up: tell us where you are and show interest.{" "}
        <Link href="/show-interest">show interest →</Link>
      </p>
    </main>
  );
}
