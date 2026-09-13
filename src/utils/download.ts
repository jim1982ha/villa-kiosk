// src/utils/download.ts
//
// Save something to the reader's device. The one owner of that.
//
// ⚠️ FIVE HAND-ROLLED COPIES EXISTED BEFORE THIS FILE, and the fifth was
// written on 2026-08-28 by somebody (me) who had just audited four others for a
// living. `SpendTab`, `ReportTab`, `TelemetryPanel`, `UsagePanel` and
// `FlagTypesPanel` each carried the identical seven lines — create a Blob, make
// an anchor, set href and download, click it, revoke the URL. Found by
// /dry-audit Part 1, which is the "roll a rule out by what it APPLIES to"
// failure in its purest form: there was no helper to violate, so nothing could
// notice.
//
// ⚠️ AND THE CONSTRAINT WAS STATED IN PROSE AT EXACTLY ONE OF THE FIVE.
// `UsagePanel`'s comment read: "A BLOB AND AN OBJECT URL, revoked immediately —
// the same idiom `TelemetryPanel.downloadAll` uses, and for the same reason:
// this add-on must work with no internet, so an export cannot go through a
// service." True, load-bearing, and invisible to anyone writing a sixth export
// who happened not to open that file. This project has paid for a rule living
// in a comment and nowhere in code before — `useLongPress` and the Enter key —
// so the constraint now lives HERE, and a caller obeys it by CALLING.
//
// ⚠️ THE REVOKE IS THE PART A COPY DROPS. An object URL pins its Blob in memory
// for the life of the document; a kiosk left running on a wall for months, with
// an owner exporting a statement a week, is exactly the process that would keep
// every one of them. It is in a `finally` so a browser that throws on `click()`
// still releases it.

/** Save `body` to the reader's device as `filename`.
 *
 *  ⚠️ NO NETWORK, BY CONSTRUCTION. Everything here is local — a Blob, an object
 *  URL and a synthetic click — which is what makes it legal under this
 *  project's second hard rule. A future "email me this" or "upload to…" is not
 *  a variant of this function; it is a different feature that has to argue with
 *  the offline rule on its own.
 */
export function downloadFile(
  filename: string, body: string, mime = "text/plain;charset=utf-8",
): void {
  const url = URL.createObjectURL(new Blob([body], { type: mime }));
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** A name safe to put in a filename: lower-case, spaces to hyphens.
 *
 *  ⚠️ IT WAS WRITTEN TWICE, in `SpendTab` and `ReportTab`, both times as
 *  `villaName.replace(/\s+/g, "-").toLowerCase()` — a villa called "Villa Del
 *  Mar" becoming `villa-del-mar`. Two is where a third becomes likely, and it
 *  belongs beside the function whose argument it feeds.
 */
export function filenameSlug(name: string): string {
  return String(name || "").trim().replace(/\s+/g, "-").toLowerCase();
}
