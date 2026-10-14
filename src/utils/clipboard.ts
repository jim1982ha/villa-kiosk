// src/utils/clipboard.ts
// Put text on the clipboard of the device the button was pressed on. True when it landed.
//
// The Clipboard API first; when it is refused (an insecure context, a kiosk lockdown, iOS quirks) the old
// textarea + execCommand route. ⚠️ BOTH NEED A RECENT TAP: a browser lets a page write the clipboard only shortly
// after the person touched it, so a result that took 15 s to compute (the frame-cost probe) may be refused — the
// caller says so and leaves a Copy button, never claims it copied.

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    try { return document.execCommand("copy"); } catch { return false; } finally { document.body.removeChild(ta); }
  }
}
