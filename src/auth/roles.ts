// src/auth/roles.ts
// The three kiosk profiles. Pure identity data — what each profile may DO
// lives in permissions.ts, and who is currently signed in lives in
// ProfileContext.tsx, so each concern can change independently.

import ROLE_TABLE from "../../rootfs/usr/share/vesta/roles.json" with { type: "json" };

/** Kiosk profile. "ops" is the facility manager / caretaker. */
export type Role = "guest" | "owner" | "ops";

/** Fixed display order for the profile-select screen. */
export const ROLE_ORDER: Role[] = ["guest", "owner", "ops"];

/** Each profile's display name — the sign-in card, "Signed in as", the stamp on a fault's steps ("by Guest") — from
 *  the one role table (roles.json `profiles.<role>.label`), which the proxy reads too for the name it accepts on a
 *  guest's report. ⚠️ WRITTEN HERE AND COPIED INTO THE PROXY (architecture review, 2026-10-19): "Guest" stood as a
 *  literal in supervisor-proxy.py and its test; a renamed profile would have had every guest report refused. */
export const ROLE_LABELS: Record<Role, string> = Object.fromEntries(
  ROLE_ORDER.map((r) => [r, ROLE_TABLE.profiles[r].label]),
) as Record<Role, string>;

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
  guest: "Enjoy the villa: comfort, lights, music and doors.",
  owner: "Everything at a glance: protection, energy, water, internet.",
  ops: "On-site view: device health, batteries, what needs attention.",
};

/** Runtime whitelist check for values read from storage or the network. */
export function isRole(value: unknown): value is Role {
  return value === "guest" || value === "owner" || value === "ops";
}
