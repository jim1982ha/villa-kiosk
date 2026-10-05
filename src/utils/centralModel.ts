// src/utils/centralModel.ts
// The add-on's CENTRAL model: its configuration (/addon-config), the
// version-stamped URL the service worker caches by, and the upload. Split out
// of utils/storage.ts (round 10, 2.496.162).

import { ingressPath } from "@/ha/ingress";
import { devLog } from "@/utils/devLog";
import { backendFetch } from "@/auth/sessionLost";


// ── Add-on central configuration ────────────────────────────────────────────
// The 3D model is uploaded once through the kiosk's Settings and stored in the
// add-on's private /data volume; all clients load it from the add-on's /model/
// endpoint (session-gated). A per-browser IndexedDB upload is only the fallback
// before any central model exists.

export interface AddonConfig {
  /** Served path under /model/, e.g. "villa.glb". Empty = none uploaded yet. */
  model_path: string;
  /**
   * Provenance of the file currently AT model_path: a central upload
   * overwrites that file in place, so the served name never changes — this
   * records the original browser-side filename + time of the last upload
   * (null/absent when the file was placed manually or by an older add-on).
   */
  model_upload?: { original_name: string; uploaded_at: string } | null;
  /** Same provenance for the room-data sidecar (<model>.rooms.json). */
  rooms_upload?: { original_name: string; uploaded_at: string } | null;
  /** The version of each file, in nginx's ETag form ("<mtime hex>-<size hex>"),
   *  "" when the file does not exist — see modelUrl. */
  model_version?: string;
  rooms_version?: string;
}

/** The room-data sidecar URL that sits next to the central GLB (model_path
 *  with its .glb swapped for .rooms.json). The pipeline emits it; the app
 *  reads it instead of the old multi-hundred-MB .sh3d. */
export function roomsPathFor(modelPath: string): string {
  return modelPath.replace(/\.glb$/i, ".rooms.json");
}

/**
 * A central file's URL, stamped with the version the add-on reported for it
 * in /addon-config (`model_version` / `rooms_version`). The stamp is what lets
 * the service worker cache a many-MB GLB forever (nginx marks a `?v=` request
 * immutable) yet fetch a replaced file exactly once: a new upload, a new stamp.
 *
 * ⚠️ THE ADD-ON SAYS WHICH VERSION; THE CLIENT NO LONGER GUESSES (2.496.254).
 * It used to send a HEAD request per file per open and read the ETag, with a
 * 3 s timeout, a per-page memo (two callers racing could disagree) and a
 * localStorage fallback (a failed HEAD must not change the URL and force a
 * re-download). All of that existed to learn something the add-on already
 * knew when it answered /addon-config — it stats the file there. The add-on
 * reports it in nginx's own ETag format, so a stamp already in a device's
 * cache keeps matching and nothing is downloaded again.
 */
export function modelUrl(relPath: string, version: string | null | undefined): string {
  // The add-on's nginx serves central files at /model/ (an alias onto the
  // add-on's /data volume, session-gated), resolved against the base path so
  // it works both in the sidebar (Ingress prefix) and on the direct hostname.
  const url = ingressPath(`model/${relPath}`);
  return version ? `${url}?v=${encodeURIComponent(version)}` : url;
}

/** The central GLB's URL from an add-on answer, or "" when it has none. */
export const centralModelUrl = (cfg: AddonConfig): string =>
  cfg.model_path ? modelUrl(cfg.model_path, cfg.model_version) : "";

/** The central room data's URL from an add-on answer, or "" when it has none. */
export const centralRoomsUrl = (cfg: AddonConfig): string =>
  cfg.model_path ? modelUrl(roomsPathFor(cfg.model_path), cfg.rooms_version) : "";

let _addonConfigCache: AddonConfig | null = null;

/** Drop the cached add-on config so the next fetchAddonConfig() re-reads it
 *  (e.g. right after a central upload changes the effective paths). */
export function clearAddonConfigCache(): void {
  _addonConfigCache = null;
}


// HA's Ingress gateway rejects any single request over ~16 MB with HTTP 413
// (a Supervisor-level cap the add-on cannot raise), so anything bigger goes up
// as sequential ~8 MB pieces the supervisor-proxy reassembles server-side.
// 12 MB single-shot threshold leaves margin under the cap.
const SINGLE_SHOT_MAX_BYTES = 12 * 1024 * 1024;
const UPLOAD_CHUNK_BYTES = 8 * 1024 * 1024;

/** Per-attempt ceiling, ESCALATING. It exists to turn a HUNG request into a
 *  readable error rather than to police speed — without it a stalled chunk left
 *  the button reading "Uploading…" forever with nothing logged and no way to
 *  tell a slow upload from a dead one.
 *
 *  Why it escalates instead of sitting at one generous value: a field capture
 *  showed the first chunk stall at `offset=0` with ZERO bytes moved, our own
 *  AbortController cancel it at the two-minute mark, and a manual retry then
 *  complete in 920 ms. A flat 120 s meant every blip on the public hop cost two
 *  minutes of a `0%` badge and a human deciding to try again.
 *
 *  The first attempt is short enough that a blip is noticed in well under a
 *  minute, and the LAST is the old generous value so a genuinely slow uplink
 *  still finishes. The floor that first number assumes is ~1.5 Mbit/s up for an
 *  8 MB chunk; below that the first attempt is abandoned and re-sent, which
 *  costs bandwidth but not the upload. Erring the other way — one long
 *  timeout — costs the two minutes this exists to remove. */
const UPLOAD_ATTEMPT_TIMEOUTS_MS = [45_000, 90_000, 120_000];
/** Between attempts. Short: the failure being retried is a stalled connection,
 *  not a rate limit, and the attempt itself already waited a long time. */
const UPLOAD_RETRY_DELAY_MS = [700, 2_000];

/** An error the connection caused, as opposed to an answer the server gave.
 *  Only this kind is retried — see postUploadRequest. */
class TransientUploadError extends Error {}

async function postUploadOnce(
  query: string, body: Blob, timeoutMs: number,
): Promise<{ path: string; size: number }> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  let resp: Response;
  try {
    resp = await backendFetch(ingressPath(`model-upload?${query}`), {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body,
      signal: ctl.signal,
    });
  } catch (e) {
    throw new TransientUploadError(
      (e as Error)?.name === "AbortError"
        ? `Upload stalled — no response from the add-on within ${timeoutMs / 1000}s.`
        : `Upload failed: ${(e as Error)?.message || "network error"}`,
    );
  } finally {
    clearTimeout(timer);
  }
  if (!resp.ok) {
    let msg = `Upload failed (HTTP ${resp.status})`;
    try {
      const j = await resp.json() as { error?: string };
      if (j?.error) msg = j.error;
    } catch { /* non-JSON error body */ }
    // NOT transient: a 413/401/500 is an ANSWER — the file is too big, the
    // session expired, the add-on refused it. Re-sending 8 MB to be told the
    // same thing three times helps nobody and delays the real message. Same
    // rule fetchModelWithRetry applies to a non-ok download.
    throw new Error(msg);
  }
  return resp.json() as Promise<{ path: string; size: number }>;
}

/**
 * One chunk, retried through a stalled connection.
 *
 * Retrying is SAFE because the chunk protocol is idempotent: the server keys a
 * partial upload by `upload_id` and writes each piece at its own `offset`
 * (cutting the file back to it first), so re-sending the same piece — whether
 * it had landed in full or the connection dropped half-way — overwrites the
 * same bytes. That is what makes this a retry rather than a corruption risk,
 * and it is why the wrapper lives here — around the request that carries those
 * two parameters — rather than around the whole file.
 *
 * ⚠️ UNTIL 2.496.166 THIS PARAGRAPH WAS NOT TRUE. The server APPENDED and
 * required its size to equal the offset exactly, and deleted the pieces on a
 * dropped connection — so a retry of any piece after the first was a 409.
 * tests/proxy-rules.py now drives the handler through both retries.
 */
async function postUploadRequest(
  query: string,
  body: Blob,
  /** Fires before each backoff, so the UI can say "retrying" instead of
   *  freezing at the same percentage with no explanation. */
  onRetry?: (attempt: number, of: number) => void,
): Promise<{ path: string; size: number }> {
  const attempts = UPLOAD_ATTEMPT_TIMEOUTS_MS.length;
  for (let i = 0; ; i++) {
    try {
      return await postUploadOnce(query, body, UPLOAD_ATTEMPT_TIMEOUTS_MS[i]);
    } catch (e) {
      if (!(e instanceof TransientUploadError) || i >= attempts - 1) {
        // Out of attempts on a transient failure: say what was actually tried,
        // because "it stalled" and "it stalled three times over three minutes"
        // are different problems for whoever reads it.
        if (e instanceof TransientUploadError) {
          throw new Error(`${e.message} Gave up after ${attempts} attempts.`);
        }
        throw e;
      }
      devLog(`[uploadCentralModel] attempt ${i + 1}/${attempts} stalled, retrying…`, e);
      onRetry?.(i + 1, attempts);
      await new Promise((r) => setTimeout(r, UPLOAD_RETRY_DELAY_MS[i]));
    }
  }
}

/**
 * Upload a central model file (GLB or room-data sidecar) to the add-on, which
 * writes it into its own /data store (overwriting the previous one) via the
 * supervisor-proxy's /model-upload endpoint. Returns the resolved path.
 * Invalidates the addon-config cache so the freshly-uploaded model is picked up
 * on the next fetch. Takes a Blob so a caller can upload a re-packaged Blob if
 * needed. Files above ~12 MB go up via the chunked protocol.
 */
export async function uploadCentralModel(
  file: Blob,
  kind: "glb" | "rooms",
  originalName?: string,
  /** Called as each chunk lands, so a multi-chunk upload can show real
   *  progress. A 19 MB GLB is three round trips; without this the UI cannot
   *  distinguish "chunk 2 of 3 in flight" from "wedged". */
  onProgress?: (sentBytes: number, totalBytes: number) => void,
  /** Called when a chunk stalled and is being re-sent — see postUploadRequest. */
  onRetry?: (attempt: number, of: number) => void,
): Promise<{ path: string; size: number }> {
  // The original filename rides along so the add-on can record WHAT was
  // uploaded (the destination file keeps the configured name forever).
  const nameQ = originalName ? `&name=${encodeURIComponent(originalName)}` : "";
  const base = `kind=${kind}${nameQ}`;

  let result: { path: string; size: number };
  if (file.size <= SINGLE_SHOT_MAX_BYTES) {
    result = await postUploadRequest(base, file, onRetry);
    onProgress?.(file.size, file.size);
  } else {
    const uploadId =
      typeof crypto?.randomUUID === "function"
        ? crypto.randomUUID()
        : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}0000`;
    result = { path: "", size: 0 };
    for (let offset = 0; offset < file.size; offset += UPLOAD_CHUNK_BYTES) {
      const piece = file.slice(offset, offset + UPLOAD_CHUNK_BYTES);
      const last = offset + UPLOAD_CHUNK_BYTES >= file.size;
      result = await postUploadRequest(
        `${base}&upload_id=${uploadId}&offset=${offset}${last ? "&last=1" : ""}`,
        piece,
        onRetry,
      );
      onProgress?.(Math.min(offset + UPLOAD_CHUNK_BYTES, file.size), file.size);
    }
  }
  _addonConfigCache = null;
  return result;
}

/** What asking the add-on for its model produced: its answer, or no answer
 *  at all (`status` when it replied with an error, absent when the request
 *  itself failed). */
export type AddonConfigAnswer =
  | { ok: true; cfg: AddonConfig }
  | { ok: false; status?: number };

/**
 * Ask the add-on which model it holds (/addon-config).
 *
 * ⚠️ "NO ANSWER" IS NOT "NO MODEL" (2.496.254). This used to return
 * `{model_path: ""}` for every failure — a 502 while the add-on restarted, an
 * expired session, three dropped requests — and the load read that as "the
 * villa has no model" and showed the upload screen on a villa that had one,
 * until something reloaded the page. Only a 200 is an answer; anything else
 * is returned as no answer, and the caller decides (modelSource retries it).
 *
 * A network-level failure (fetch throwing, or the 3 s abort on a slow public
 * hop) is retried twice here with a short backoff; an HTTP status is returned
 * at once — a 401 is the expected "not signed in yet" of the pre-login
 * prefetch, and retrying it would only delay that screen.
 *
 * Cached after the first 200 (even one reporting an empty model_path); a
 * failure never is, so an early 401 cannot poison the post-login call.
 */
export async function readAddonConfig(): Promise<AddonConfigAnswer> {
  if (_addonConfigCache) return { ok: true, cfg: _addonConfigCache };
  const ATTEMPTS = 3;
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    try {
      const ctrl = new AbortController();
      const tid = setTimeout(() => ctrl.abort(), 3000);
      let resp: Response;
      try {
        resp = await backendFetch(ingressPath("addon-config"), { signal: ctrl.signal });
      } finally {
        clearTimeout(tid);
      }
      if (!resp.ok) return { ok: false, status: resp.status };
      const cfg = await resp.json() as AddonConfig;
      _addonConfigCache = cfg;
      return { ok: true, cfg };
    } catch {
      if (attempt < ATTEMPTS - 1) await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
    }
  }
  return { ok: false };
}

/** readAddonConfig for a caller to whom no answer and no model are the same
 *  thing — the pre-login prefetch (nothing to fetch yet) and Settings' model
 *  info (nothing to show). Never the load: see readAddonConfig. */
export async function fetchAddonConfig(): Promise<AddonConfig> {
  const got = await readAddonConfig();
  return got.ok ? got.cfg : { model_path: "" };
}
