import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { txnDb } from "@/lib/db/pool";
import { users, areas, interestSignals, activityTypes } from "@/lib/db/schema";
import { resolveHome } from "@/lib/geo";
import { slackNewPlayer } from "@/lib/slack";

export type CreateMemberInput = {
  email: string;
  displayName: string;
  passwordHash?: string | null;
  emailVerified?: Date | null;
  verificationToken?: string | null;
  // location — required: it's both the user's home and their interest signal.
  zip: string;
  line1?: string;
  line2?: string;
  city?: string;
  state?: string;
};
export type CreateMemberResult = { ok: true; userId: string } | { ok: false; error: string };

/**
 * The ONE path that creates an account. A registered user is, by construction, a
 * user row WITH a home and an active interest signal — so we create all three in
 * a single transaction. Nothing else inserts into `users`; this is what makes the
 * "registered with no interest" state impossible.
 *
 * Runs on txnDb (the WebSocket/pg pool) because neon-http can't hold a real
 * transaction. resolveHome (geo lookup) happens before the txn; only writes are
 * inside it.
 */
export async function createMember(input: CreateMemberInput): Promise<CreateMemberResult> {
  const email = input.email.toLowerCase().trim();
  const displayName = input.displayName.trim() || email.split("@")[0];
  // This is the single users-insert boundary, so enforce the email invariant here
  // rather than trusting every caller.
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, error: "enter a valid email" };
  if (!/^\d{5}$/.test(input.zip)) return { ok: false, error: "Enter a valid 5-digit ZIP code." };

  const home = await resolveHome({
    zip: input.zip, line1: input.line1, line2: input.line2, city: input.city, state: input.state,
  });
  if (!home) return { ok: false, error: "We couldn't find that ZIP code." };

  const [activity] = await db.select({ id: activityTypes.id }).from(activityTypes)
    .where(eq(activityTypes.slug, "flag-football")).limit(1);
  if (!activity) return { ok: false, error: "Flag football isn't configured yet." };

  try {
    const userId = await txnDb.transaction(async (tx) => {
      const [u] = await tx.insert(users).values({
        email, displayName,
        passwordHash: input.passwordHash ?? null,
        emailVerified: input.emailVerified ?? null,
        verificationToken: input.verificationToken ?? null,
        addressLine1: input.line1 || null,
        addressLine2: input.line2 || null,
        city: home.displayCity,
        state: input.state || null,
        zip: input.zip,
        homeLat: home.homeLat, homeLng: home.homeLng,
        h3R5: home.r5, h3R6: home.r6, h3R7: home.r7, h3R8: home.r8, h3R9: home.r9,
      }).returning({ id: users.id });

      // Area for the user's home cell (upsert), in the same txn.
      const ins = await tx.insert(areas).values({
        activityTypeId: activity.id, h3Cell: home.r7,
        displayCity: home.displayCity, displayZip: input.zip,
        centerLat: home.snapLat, centerLng: home.snapLng,
      }).onConflictDoNothing().returning({ id: areas.id });
      let areaId = ins[0]?.id;
      if (!areaId) {
        const [ex] = await tx.select({ id: areas.id }).from(areas)
          .where(and(eq(areas.activityTypeId, activity.id), eq(areas.h3Cell, home.r7))).limit(1);
        areaId = ex.id;
      }

      // The interest signal — the whole reason this is one transaction.
      await tx.insert(interestSignals).values({
        activityTypeId: activity.id, userId: u.id, areaId, h3Base: home.r7, active: true,
      });
      return u.id;
    });
    // Activity feed: a new player joined (the account + interest both committed).
    slackNewPlayer({ displayName, email, city: home.displayCity, zip: input.zip });
    return { ok: true, userId };
  } catch (e) {
    const code = (e as { cause?: { code?: string }; code?: string }).cause?.code ?? (e as { code?: string }).code;
    const msg = e instanceof Error ? e.message : String(e);
    if (code === "23505" || /unique|duplicate|23505/i.test(msg)) {
      return { ok: false, error: "an account with that email already exists — log in instead" };
    }
    throw e;
  }
}
