// src/auth/roles.ts
// The three kiosk profiles. Pure identity data — what each profile may DO
// lives in permissions.ts, and who is currently signed in lives in
// ProfileContext.tsx, so each concern can change independently.

import ROLE_TABLE from "../../rootfs/usr/share/vesta/roles.json" with { type: "json" };

/** Kiosk profile. "ops" is the facility manager / caretaker. */
export type Role = "guest" | "owner" | "ops";

/** Fixed display order for the profile-select screen. */
export const ROLE_ORDER: Role[] = ["guest", "owner", "ops"];

/** A profile's words, from the one role table (roles.json `profiles.<role>`): the agreement carries the same words to
 *  the VESTA Agent (agent-contract.json `profiles`). ⚠️ THE INITIALS AND DESCRIPTIONS WERE CONSTANTS HERE (architecture
 *  review round 8, 2026-10-30), and the Facility Manager had three names: "Facility manager" on the tablet, "FM" and
 *  "Facility Manager" on Telegram. */
const words = (field: "label" | "short" | "initials" | "description"): Record<Role, string> =>
  Object.fromEntries(ROLE_ORDER.map((r) => [r, ROLE_TABLE.profiles[r][field]])) as Record<Role, string>;

/** Each profile's name: the sign-in card, "Signed in as", a fault's source and the author of its steps ("by Guest"). */
export const ROLE_LABELS: Record<Role, string> = words("label");

/** Each profile's name where space is tight (an alert card's "To: FM"). */
export const ROLE_SHORT: Record<Role, string> = words("short");

/** The letter(s) in the top bar's round signed-in badge (HUD.tsx's .hud-role-badge) and a fault's source icon: short
 *  enough for a 40px circle, and "FM" rather than "O" for ops so it can never read as the Owner's. */
export const ROLE_INITIALS: Record<Role, string> = words("initials");

/** One-line pitch under each profile button. */
export const ROLE_DESCRIPTIONS: Record<Role, string> = words("description");

/** What a profile's step on the Facility record is stamped with: its id, and its label (the words the VESTA Agent
 *  writes to Telegram, until it reads the id: agent-contract.json `profiles`). */
export function authorStamp(role: Role): { by: string; role: Role } {
  return { by: ROLE_LABELS[role], role };
}

/** The profile a stored step or completion was written by, or null (the VESTA Agent, a typed name, nobody). Its `role`
 *  when it has one; else its `by` read as a profile's label, today's or a former one (roles.json `formerLabels`).
 *  ⚠️ STEPS STORED A PROFILE'S WORDS (to 2.496.622): every step written before then says "Facility manager", and is
 *  read here as the Facility Manager's, so renaming a profile renames its old steps too. */
export function roleOfStamp(s: { role?: unknown; by?: unknown } | undefined): Role | null {
  if (!s) return null;
  if (isRole(s.role)) return s.role;
  return ROLE_ORDER.find((r) => s.by === ROLE_LABELS[r] || formerLabels(r).includes(s.by as string)) ?? null;
}

function formerLabels(r: Role): readonly string[] {
  const row = ROLE_TABLE.profiles[r] as { formerLabels?: readonly string[] };
  return row.formerLabels ?? [];
}

/** Who wrote a step, as every screen says it: the profile's name today, else the words stored ("VESTA Agent"); "" for
 *  nobody. */
export function authorWords(s: { role?: unknown; by?: unknown } | undefined): string {
  const role = roleOfStamp(s);
  if (role) return ROLE_LABELS[role];
  return typeof s?.by === "string" ? s.by : "";
}

/** Runtime whitelist check for values read from storage or the network. */
export function isRole(value: unknown): value is Role {
  return value === "guest" || value === "owner" || value === "ops";
}
