// src/ai/settingsApi.ts
// The AI layer's settings, read and written by the kiosk's own UI.
//
// ⚠️ NOT ADD-ON OPTIONS. Writing an add-on's own options needs `hassio_api`
// plus a Supervisor role that can also start, stop and install add-ons — an
// escalation a suggest-only layer cannot justify, refused in the manifest and
// pinned by a test. These live in the add-on's own /data, like the shared
// device configuration and the facility record.
//
// ⚠️ AND THE TWO SECRETS ARE WRITE-ONLY. The server reports only WHETHER each
// is set; the value never travels back. A credential that round-trips through a
// wall-mounted tablet's DOM is a credential on the wall.

import { ingressPath } from "@/ha/ingress";

export interface AiSettings {
  ha_mcp_url: string;
  owner_target: string;
  fm_target: string;
  timezone: string;
  daily_usd_limit: number;
  model_fast: string;
  model_writing: string;
  ai_log_level: string;
  /** Whether a key is stored — never the key. */
  anthropic_api_key_set: boolean;
  ha_mcp_secret_set: boolean;
}

/** What a save sends. A secret is included ONLY when the operator typed a new
 *  one; omitting it keeps what is stored, and `""` clears it. */
export type AiSettingsDraft = Omit<AiSettings, "anthropic_api_key_set" | "ha_mcp_secret_set">
  & { anthropic_api_key?: string; ha_mcp_secret?: string };

export const EMPTY_AI_SETTINGS: AiSettings = {
  ha_mcp_url: "", owner_target: "", fm_target: "", timezone: "",
  daily_usd_limit: 1, model_fast: "", model_writing: "", ai_log_level: "info",
  anthropic_api_key_set: false, ha_mcp_secret_set: false,
};

async function json<T>(res: Response): Promise<T> {
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
  return body as T;
}

export const fetchAiSettings = async (): Promise<AiSettings> =>
  json<AiSettings>(await fetch(ingressPath("ai-settings"), { credentials: "same-origin" }));

export const saveAiSettings = async (draft: AiSettingsDraft): Promise<AiSettings> =>
  json<AiSettings>(await fetch(ingressPath("ai-settings"), {
    method: "PUT",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(draft),
  }));
