// A window's two exits (owner, 2026-10-20): Save saves AND closes, Cancel undoes every change — every tab's — and
// closes; a passing notice says which, only when something changed. Escape and the backdrop are Cancel. By value
// (ModalFooter's footerExits), and the wiring by the screens' own tree.
import { register } from "node:module";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";
import { readFileSync, existsSync } from "node:fs";
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

// ⚠️ NOTHING IS SAVED AT ONCE (owner, 2026-11-06: one way of saving; architecture review 19 #1 had Cancel name "Who gets
// the messages" as already saved): Cancel says the one notice, whatever was changed; Settings' Save carries the error
// of a list the villa refused (tests/oracles/settings_save.mjs drives the lists themselves)
{
  const d = draft({ keptAtOnce: ["Who gets the messages"] });
  const log = await run(d.commit, "cancel");
  ck("Cancel never names a section as already saved: what changed is cancelled",
     d.did.join() === "discarded" && log.join("|") === `closed|${CANCELLED_NOTICE}`, log);
  const st = src("components/settings/SettingsModal.tsx");
  ck("  ...no dialog keeps a list of what it saved at once", !/keptAtOnce/.test(st + src("components/common/ModalFooter.tsx"))
     && /const commit = \{\s*dirty: slice\.dirty,\s*saving: slice\.saving,\s*error: slice\.problem,\s*save: slice\.save,/.test(st));
}

ck("Settings' Escape and backdrop are the same Cancel, and no question is asked any more",
   /const closeModal = footerExits\(commit, onClose, notice\)\.cancel;/.test(src("components/settings/SettingsModal.tsx"))
   && !existsSync(new URL("../../src/components/common/UnsavedChanges.tsx", import.meta.url))
   && !/UnsavedChanges|pendingTab/.test(src("components/common/ModalTabs.tsx")));
ck("the notice is the villa view's own passing notice (AppNotice), provided by the page",
   /<AppNoticeContext\.Provider value=\{setNotice\}>/.test(src("pages/Dashboard.tsx")));

// ⚠️ THE FOOTER OWNS ITS EXITS (architecture review K, 2026-10-24): a Back beside Save · Cancel was a third way out
// that said nothing of the changes. Drawn: Back only where there is no Cancel.
{
  const { h, draw } = await import("../consistency/screen.mjs");
  const ModalFooter = (await import("@/components/common/ModalFooter")).default;
  const labels = (props) => [...draw(h(ModalFooter, { onClose: () => {}, back: { go: () => {}, to: "Settings" }, ...props }))
    .matchAll(/<button[^>]*aria-label="([^"]+)"/g)].map((m) => m[1]);
  const withCancel = labels({ commit: { dirty: true, save: () => {}, discard: () => {} } });
  ck("with Save · Cancel: no Back (Cancel is the way out)", !withCancel.includes("Back to Settings") && withCancel.includes("Cancel"), withCancel);
  const alone = labels({ actions: h("span") });
  ck("with nothing to save: Back, named for where it returns", alone.includes("Back to Settings"), alone);

  // each footer the piece draws, by its buttons: the one with a Save holds Cancel and no Close; Close is the exit of
  // the footer that has nothing to save (owner, 2026-11-10: in Save's shape, its glyph and its word); a window that
  // asks one thing ends in the same Cancel and its answer (common/Answers)
  const { text } = await import("../consistency/screen.mjs");
  const drawn = (props) => draw(h(ModalFooter, { onClose: () => {}, ...props }));
  const names = (html) => [...html.matchAll(/<button[^>]*aria-label="([^"]+)"/g)].map((m) => m[1]);
  const save = names(drawn({ commit: { dirty: true, save: () => {}, discard: () => {} } }));
  const plain = names(drawn({}));
  ck("the footer's buttons are Cancel and Save, no Close beside a Save", save.join() === "Cancel,Save" && plain.join() === "Close", [save, plain]);
  const asks = drawn({ answer: { label: "Send report", onPress: () => {} }, error: "The villa's system did not answer." });
  ck("a window that asks one thing: what went wrong, then Cancel and its answer, the same pair",
     text(asks) === "|The villa's system did not answer.|[icon]|Cancel|[icon]|Send report|" && names(asks).join() === "Cancel", text(asks));
}

done("✅ Save saves and closes; Cancel undoes and closes; the notice says which; Back only where there is no Cancel");
