// Brand palette. Flags represent two teams — yellow vs blue — so on the map a
// cluster reads like a football lineup (one team facing the other).
export const TEAM_YELLOW = "#f4c430";
export const TEAM_BLUE = "#2f6fd8";
export const TEAM_COLORS = [TEAM_YELLOW, TEAM_BLUE] as const;

// "grass fields" palette — light → dark. Mirrored in CSS custom properties for
// UI accents; available here for the canvas (map tint accents, count labels).
export const GRASS = {
  l1: "#5b9452",
  l2: "#468944",
  l3: "#3f7a39",
  l4: "#376f32",
  l5: "#30632a",
} as const;
