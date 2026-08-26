// src/auth/roles.ts
// The three kiosk profiles. Pure identity data — what each profile may DO
// lives in permissions.ts, and who is currently signed in lives in
// ProfileContext.tsx, so each concern can change independently.

/** Kiosk profile. "ops" is the facility manager / facility manager. */
export type Role = "guest" | "owner" | "ops";

/** Fixed display order for the profile-select screen. */
export const ROLE_ORDER: Role[] = ["guest", "owner", "ops"];

export const ROLE_LABELS: Record<Role, string> = {
  guest: "Guest",
  owner: "Owner",
  ops: "Facility manager",
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
