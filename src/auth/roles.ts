// src/auth/roles.ts
// The three kiosk profiles. Pure identity data — what each profile may DO
// lives in permissions.ts, and who is currently signed in lives in
// ProfileContext.tsx, so each concern can change independently.

/** Kiosk profile. "ops" is the facility manager / caretaker. */
export type Role = "guest" | "owner" | "ops";

/** Fixed display order for the profile-select screen. */
export const ROLE_ORDER: Role[] = ["guest", "owner", "ops"];

export const ROLE_LABELS: Record<Role, string> = {
  guest: "Guest",
  owner: "Owner",
  ops: "Facility manager",
};

/** The letter(s) in the top bar's round signed-in badge (HUD.tsx's
 *  .hud-role-badge): short enough for a 40px circle, and "FM" rather than
 *  "O" for ops so it can never read as the Owner's. */
export const ROLE_INITIALS: Record<Role, string> = {
  guest: "G",
  owner: "O",
  ops: "FM",
};

/** One-line pitch under each profile button (mirrors the product spec). */
export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  guest: "Enjoy the villa — comfort, lights, music and doors.",
  owner: "Everything at a glance — protection, energy, water, internet.",
  ops: "On-site view — device health, batteries, what needs attention.",
};

/** Runtime whitelist check for values read from storage or the network. */
export function isRole(value: unknown): value is Role {
  return value === "guest" || value === "owner" || value === "ops";
}
