// Brand palette. Flags represent two teams — yellow vs red — bright and opaque
// so they stand out against the green field.
export const TEAM_YELLOW = "#f4c430";
export const TEAM_RED = "#e23b2e";
export const TEAM_COLORS = [TEAM_YELLOW, TEAM_RED] as const;

// "grass fields" palette — light → dark. Mirrored in CSS custom properties for
// UI accents; available here for the canvas (map tint accents, count labels).
export const GRASS = {
  l1: "#5b9452",
  l2: "#468944",
  l3: "#3f7a39",
  l4: "#376f32",
  l5: "#30632a",
} as const;
