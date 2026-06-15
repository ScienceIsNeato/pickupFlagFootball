import raw from "@/config/skins/flag-football.json";
import { SkinSchema, type Skin } from "./schema";

/**
 * The active skin. Parsed + validated once at module load (fail-fast).
 * Swap this import (or make it env/route-driven) to run a different activity.
 */
export const skin: Skin = SkinSchema.parse(raw);

export type { Skin };
