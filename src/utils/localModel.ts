// src/utils/localModel.ts
// What an older version left in THIS browser, and its removal.
//
// Until 2.496.254 a model could be kept in this browser's IndexedDB — the
// fallback before an add-on model existed, and where the no-model screen's
// upload went. Every model now lives in the add-on (see modelSource), so a
// copy found here is dead weight, often tens of MB on a tablet: deleted on
// the next load. The `villa-kiosk:model-tag:*` keys are the version stamps
// the HEAD probe used to remember (see centralModel.modelUrl).

import { readString, removeStored, removeStoredPrefix } from "./storedJson";

const DB_NAME = "villa-kiosk-db";
const META_KEY = "villa-kiosk:model-meta";
const TAG_PREFIX = "villa-kiosk:model-tag:";

/** Delete what an older version stored. Cheap when there is nothing: the
 *  database is only touched when its metadata record says a model was saved.
 *  Never throws — a browser refusing the delete costs only the space. */
export async function forgetBrowserModel(): Promise<void> {
  removeStoredPrefix(TAG_PREFIX);
  if (readString(META_KEY) === null) return; // nothing was saved (or storage is off)
  await new Promise<void>((resolve) => {
    try {
      const req = indexedDB.deleteDatabase(DB_NAME);
      req.onsuccess = req.onerror = req.onblocked = () => resolve();
    } catch {
      resolve();
    }
  });
  removeStored(META_KEY);
}
