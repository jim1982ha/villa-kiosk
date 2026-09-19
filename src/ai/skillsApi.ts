// src/ai/skillsApi.ts
// The kiosk's half of Skill management.
//
// ⚠️ PLAIN FILES OVER THE ADD-ON'S OWN PROXY, NOT AN API ON A SECOND ADD-ON.
// The AI layer runs in this same container (docs/adr/0016), so its Skills are
// files this add-on can already read and write. A ticket existed to give the
// layer an HTTP surface for exactly this and was cancelled when the two add-ons
// became one.

import { ingressPath } from "@/ha/ingress";

export interface SkillMeta {
  path: string;
  department: string;
  name: string;
  title: string;
  enabled: boolean;
  bytes: number;
  modified: number;
  unreadable?: boolean;
}

export interface SkillListing {
  /** Where the folder is inside the container, or null when none is mapped —
   *  which is a manifest fault, not an empty library. */
  root: string | null;
  skills: SkillMeta[];
  departments: string[];
  error?: string;
}

/** ⚠️ THE SERVER'S OWN MESSAGE, NOT "something went wrong". Every refusal
 *  here is actionable — a department that is not one, a file too large, a role
 *  that may not write — and swallowing it into a generic string is what makes
 *  an editor feel broken rather than strict. */
async function json<T>(res: Response): Promise<T> {
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
  return body as T;
}

const call = (rel: string, init?: RequestInit) =>
  fetch(ingressPath(rel), { credentials: "same-origin", ...init });

export const listSkills = async (): Promise<SkillListing> =>
  json<SkillListing>(await call("ai-skills"));

export const readSkill = async (path: string): Promise<string> =>
  (await json<{ content: string }>(await call(`ai-skills/${path}`))).content;

export const writeSkill = async (path: string, content: string): Promise<SkillMeta> =>
  json<SkillMeta>(await call(`ai-skills/${path}`, {
    method: "PUT",
    headers: { "Content-Type": "text/markdown" },
    body: content,
  }));

export const deleteSkill = async (path: string): Promise<void> => {
  await json(await call(`ai-skills/${path}`, { method: "DELETE" }));
};

/** ⚠️ `enabled: false` SWITCHES A SKILL OFF WITHOUT DELETING IT (ticket 27).
 *  Toggling is a content edit rather than a separate endpoint, so there is one
 *  source of truth for whether a Skill is on: the file. */
export function setEnabled(content: string, enabled: boolean): string {
  const line = `enabled: ${enabled}`;
  if (/^enabled:\s*(true|false)\s*$/im.test(content)) {
    return content.replace(/^enabled:\s*(true|false)\s*$/im, line);
  }
  return `${line}\n${content}`;
}

export const TEMPLATE = (name: string) => `# ${name}

enabled: true

## What this watches

Describe the thing on the property this Skill is about, in a sentence.

## What it does not cover

⚠️ Say this plainly. Coverage can only be honest if every Skill states its own
edges.

## What to say

The prose the layer uses when it has something to report.
`;
