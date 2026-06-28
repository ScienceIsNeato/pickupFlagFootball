/**
 * Local-testing helper: mint a verified email+password user who's an active
 * member of a game with the donation reminder on — i.e. exactly the state that
 * should show the support banner. Idempotent. NOT for prod.
 *
 *   node --env-file=.env.local --import tsx scripts/make-test-member.ts
 *   → log in at the site with the printed email / password.
 */
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users, games, gameRoster } from "@/lib/db/schema";

const EMAIL = "banner-test@local.test";
const PASSWORD = "test1234"; // pragma: allowlist secret — throwaway local-test password, not a real credential

async function main() {
  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  const base = {
    displayName: "Banner Tester", city: "Coralville", zip: "52241",
    homeLat: 41.69, homeLng: -91.6, passwordHash,
    emailVerified: new Date(), donationStatus: "unset" as const, emailOptIn: true,
  };
  const [u] = await db.insert(users).values({ email: EMAIL, ...base })
    .onConflictDoUpdate({ target: users.email, set: base })
    .returning({ id: users.id });

  const [g] = await db.select({ id: games.id }).from(games).where(eq(games.status, "active")).limit(1);
  if (!g) throw new Error("no active game to roster onto");
  await db.insert(gameRoster).values({ gameId: g.id, userId: u.id }).onConflictDoNothing();

  console.log(`✓ test member ready\n  login: ${EMAIL} / ${PASSWORD}\n  user: ${u.id}\n  rostered on game: ${g.id}`);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
