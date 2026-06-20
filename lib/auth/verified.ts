import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";

/** True once the user has confirmed their email (or signed in with Google, which
 *  sets email_verified). Joining and proposing games require this. */
export async function isEmailVerified(userId: string): Promise<boolean> {
  const [u] = await db.select({ v: users.emailVerified }).from(users).where(eq(users.id, userId)).limit(1);
  return !!u?.v;
}

export const UNVERIFIED_MSG = "confirm your email to join or propose games — check your inbox";
