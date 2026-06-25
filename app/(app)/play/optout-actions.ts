"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { areaOptouts } from "@/lib/db/schema";

export type OptOutResult = { ok: true } | { ok: false; error: string };

/** "Not interested" in a forming site: the user opts out of THIS area's
 *  formation — it stops counting them toward its spark and stops asking them.
 *  Their interest signals are untouched, so they stay free interest elsewhere.
 *  Allowed for any signed-in user (even unverified — it's a "stop asking me").
 *  Idempotent. */
export async function declineSite(areaId: string): Promise<OptOutResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "sign in first" };
  await db.insert(areaOptouts)
    .values({ areaId, userId: session.user.id })
    .onConflictDoNothing();
  revalidatePath("/play");
  return { ok: true };
}

/** Undo a decline — the user is interested in this site again. */
export async function reExpressInterest(areaId: string): Promise<OptOutResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "sign in first" };
  await db.delete(areaOptouts)
    .where(and(eq(areaOptouts.areaId, areaId), eq(areaOptouts.userId, session.user.id)));
  revalidatePath("/play");
  return { ok: true };
}
