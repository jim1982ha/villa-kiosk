// A window's two exits (owner, 2026-10-20): Save saves AND closes, Cancel undoes every change — every tab's — and
// closes; a passing notice says which, only when something changed. Escape and the backdrop are Cancel. By value
// (ModalFooter's footerExits), and the wiring by the screens' own tree.
import { register } from "node:module";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";
import { readFileSync, existsSync } from "node:fs";
import { elements, parseTsx, propText } from "../consistency/jsx.mjs";
const { footerExits, SAVED_NOTICE, CANCELLED_NOTICE } = await import("@/components/common/ModalFooter");

const run = async (commit, which) => {
  const log = [];
  const exits = footerExits(commit, () => log.push("closed"), (m) => log.push(m.text));
  exits[which]();
  await new Promise((r) => setTimeout(r, 0));
  return log;
};
const draft = (over = {}) => {
  const did = [];
  return { did, commit: { dirty: true, save: () => { did.push("saved"); }, discard: () => { did.push("discarded"); }, ...over } };
};

{
  const d = draft();
  const log = await run(d.commit, "save");
  ck("Save: saves, closes, then says it was saved and applied", d.did.join() === "saved" && log.join("|") === `closed|${SAVED_NOTICE}`, [d.did, log]);
}
{
  const d = draft({ save: () => false });
  const log = await run(d.commit, "save");
  ck("  ...a refused save stays open and says nothing (its error is in the footer)", log.length === 0, log);
}
{
  const d = draft();
  const log = await run(d.commit, "cancel");
  ck("Cancel with changes: undoes them, closes, says they were cancelled",
     d.did.join() === "discarded" && log.join("|") === `closed|${CANCELLED_NOTICE}`, [d.did, log]);
}
{
  const d = draft({ dirty: false });
  const log = await run(d.commit, "cancel");
  ck("  ...with nothing changed: closes, undoes nothing, says nothing", d.did.length === 0 && log.join() === "closed", [d.did, log]);
}

const src = (p) => readFileSync(new URL(`../../src/${p}`, import.meta.url), "utf8");
const footer = elements(parseTsx("components/common/ModalFooter.tsx"), "button").map((b) => propText(b, "aria-label"));
ck("the footer's buttons are Save and Cancel — no Close beside a Save", footer.includes('"Cancel"') && !footer.includes('"Close"'), footer);
ck("Settings' Escape and backdrop are the same Cancel, and no question is asked any more",
   /const closeModal = footerExits\(commit, onClose, notice\)\.cancel;/.test(src("components/settings/SettingsModal.tsx"))
   && !existsSync(new URL("../../src/components/common/UnsavedChanges.tsx", import.meta.url))
   && !/UnsavedChanges|pendingTab/.test(src("components/common/ModalTabs.tsx")));
ck("the notice is the villa view's own passing notice (AppNotice), provided by the page",
   /<AppNoticeContext\.Provider value=\{setNotice\}>/.test(src("pages/Dashboard.tsx")));

done("✅ Save saves and closes; Cancel undoes and closes; the notice says which");
