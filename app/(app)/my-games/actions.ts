"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, sql } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { gameRoster, games } from "@/lib/db/schema";
import { reachableActiveGame } from "@/lib/db/gameMembership";

/**
 * Toggle whether I'm "in" for a game.
 *
 * Honest caveat: per-WEEK attendance for a standing game doesn't have its own
 * table yet, so for now this mutates the binary roster: "in" = on the roster
 * (I'm playing), "out" = off it. When we add `weekly_rsvps` we'll keep this
 * action's signature and route it to that table instead.
 */
export async function setAttendance(formData: FormData) {
  const session = await auth();
  if (!session?.user?.id) redirect("/?signin=1&next=/my-games");
  const me = session.user.id;

  const gameId = String(formData.get("gameId") ?? "");
  const status = String(formData.get("status") ?? ""); // "in" | "out"
  if (!gameId || (status !== "in" && status !== "out")) throw new Error("bad params");

  if (status === "in") {
    // Authorize the join with the radius rule: the game must be active AND
    // within my travel radius (matches the engine's catchment). The gameId
    // param alone isn't trust-bearing, so anyone can't roster onto any game.
    if (!(await reachableActiveGame(me, gameId))) throw new Error("not eligible for this game");
    await db.insert(gameRoster).values({ gameId, userId: me }).onConflictDoNothing();
    await db.update(games).set({ confirmedCount: sql`(select count(*) from game_roster where game_id = ${gameId})` })
      .where(eq(games.id, gameId));
  } else {
    // Drop is a self-edit (scoped to userId: me), no extra authorization needed.
    await db.delete(gameRoster).where(and(eq(gameRoster.gameId, gameId), eq(gameRoster.userId, me)));
    await db.update(games).set({ confirmedCount: sql`(select count(*) from game_roster where game_id = ${gameId})` })
      .where(eq(games.id, gameId));
  }

  revalidatePath("/my-games");
}
