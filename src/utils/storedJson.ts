// src/utils/storedJson.ts
// ONE way to keep a value in localStorage: absent, unusable, disabled
// (private mode, quota, a kiosk profile with storage off) all read as "not
// there" and a failed write is a no-op — never a throw.
//
// ⚠️ SIX HAND-ROLLED COPIES, ONE WITHOUT THE GUARD (2.496.196). meshCatalog,
// viewPrefs, tapDebug and autoReload each wrapped their own get/parse in
// try/catch; localModel.getModelMeta did not — a bare JSON.parse on the
// boot-critical model path and inside a React lazy initialiser, where a
// corrupt value threw instead of reading as "no stored model". Every site
// goes through here now, so the guard cannot be forgotten again.

/** The stored JSON under `key`, or null: absent, unparsable, or — when a
 *  `valid` shape check is given — not what was expected. */
export function readJson<T>(key: string, valid?: (v: unknown) => v is T): T | null {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return null;
    const v: unknown = JSON.parse(raw);
    if (valid && !valid(v)) return null;
    return v as T;
  } catch {
    return null;
  }
}

/** Store `value` as JSON. False when storage refused it. */
export function writeJson(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

/** A plain string, or null when absent or storage is disabled. */
export function readString(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}

export function writeString(key: string, value: string): boolean {
  try { localStorage.setItem(key, value); return true; } catch { return false; }
}

export function removeStored(key: string): void {
  try { localStorage.removeItem(key); } catch { /* nothing to forget */ }
}
