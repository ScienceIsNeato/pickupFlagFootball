import Link from "next/link";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { updateAccount } from "./actions";

export const metadata = { title: "Account — MIME-FF" };

export default async function AccountPage() {
  const session = await auth();
  const uid = session?.user?.id!;

  const rows = await db
    .select({ displayName: users.displayName, city: users.city, zip: users.zip })
    .from(users)
    .where(eq(users.id, uid))
    .limit(1);
  const u = rows[0] ?? { displayName: "", city: "", zip: "" };

  return (
    <main className="reg">
      <Link href="/dashboard" className="back">&larr; dashboard</Link>
      <h1 className="reg-h">your account</h1>
      <p className="reg-blurb">
        signed in as <strong>{session?.user?.email}</strong>.
        update your display name or location here.
      </p>
      <form className="reg-form" action={updateAccount}>
        <label>
          display name
          <input
            type="text"
            name="displayName"
            placeholder="first name or nickname"
            defaultValue={u.displayName ?? ""}
            autoComplete="given-name"
          />
        </label>
        <label>
          city
          <input
            type="text"
            name="city"
            placeholder="Coralville"
            defaultValue={u.city ?? ""}
            autoComplete="address-level2"
          />
        </label>
        <label>
          zip code
          <input
            type="text"
            name="zip"
            placeholder="52241"
            inputMode="numeric"
            autoComplete="postal-code"
            pattern="[0-9]{5}"
            defaultValue={u.zip ?? ""}
          />
        </label>
        <button type="submit" className="btn-green">save changes</button>
      </form>
    </main>
  );
}
