import { db } from "@/lib/db";
import { zipCentroids } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export type ZipRow = { zip: string; city: string; state: string; lat: number; lng: number };

export async function lookupZip(zip: string): Promise<ZipRow | null> {
  const rows = await db
    .select()
    .from(zipCentroids)
    .where(eq(zipCentroids.zip, zip.trim()))
    .limit(1);
  return (rows[0] as ZipRow) ?? null;
}
