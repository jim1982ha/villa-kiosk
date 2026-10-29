// ONE modal shell (2.496.175): header · body · footer, defined once, used by
// every dialog. There were three — the settings family (.settings-*), the
// panel family (.panel-*: device panels, Energy, Weather, prompts) and two
// Facility dialogs with unstyled .modal-header/.modal-body — and side by side
// they differed in header height, footer height, title size and the footer's
// left button ("keep the Energy one and use it everywhere", the owner).
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { register } from "node:module";
register("../consistency/alias-hook.mjs", import.meta.url);
const { h, draw } = await import("../consistency/screen.mjs");
const Window = (await import("@/components/common/Window")).default;

let fail = 0;
const ck = (n, ok, got) => { console.log(`    ${ok ? "PASS" : "FAIL"}  ${n}${ok || got === undefined ? "" : `  →  ${JSON.stringify(got)}`}`); if (!ok) fail++; };
const root = new URL("../../src/", import.meta.url).pathname;
const walk = (d) => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
const files = walk(root);
const css = files.filter((f) => f.endsWith(".css")).map((f) => [f, readFileSync(f, "utf8")]);
const tsx = files.filter((f) => f.endsWith(".tsx")).map((f) => [f, readFileSync(f, "utf8")]);
const noComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "");

const old = /(?<![\w-])(settings|panel)-(header|body|footer)(?![\w-])/;
const stale = [...css.map(([f, s]) => [f, noComments(s)]), ...tsx].filter(([, s]) => old.test(s)).map(([f]) => f.slice(root.length));
ck("no dialog or stylesheet uses the retired .settings-* / .panel-* section classes", stale.length === 0, stale);

// Each section's own rule, outside any media query, exactly once.
const stripMedia = (s) => {
  let out = "", i = 0;
  while (i < s.length) {
    const m = s.indexOf("@media", i);
    if (m < 0) { out += s.slice(i); break; }
    out += s.slice(i, m);
    let j = s.indexOf("{", m), depth = 0;
    for (; j < s.length; j++) { if (s[j] === "{") depth++; else if (s[j] === "}" && --depth === 0) break; }
    i = j + 1;
  }
  return out;
};
const top = css.map(([, s]) => stripMedia(noComments(s))).join("\n");
for (const sec of ["modal-header", "modal-body", "modal-footer"]) {
  const n = (top.match(new RegExp(`(^|\\n)\\s*\\.${sec}\\s*\\{`, "g")) ?? []).length;
  ck(`.${sec} is defined once`, n === 1, n);
}
ck("the card itself carries no padding in any family (the sections do)", !/\.modal:not\(\.settings-modal\)/.test(css.map(([, s]) => noComments(s)).join("\n")));
ck("every header is the same height (min-height covers the 44px device icon)", /\.modal-header \{[^}]*min-height: 84px/.test(top));
ck("ONE footer button look — the soft pill Energy had", /\.modal-footer \.btn \{[^}]*border-radius: 999px/.test(top) && !/\.panel-footer/.test(top));

// Every dialog root is built from the shell: every window (components/common/Window draws its frame), and any card
// still drawn as a dialog by hand.
const roots = tsx.filter(([f, s]) => !f.endsWith("components/common/Window.tsx")
  && (/<Window\b/.test(s) || (/className=(["`{])[^"`]*\bmodal\b(?![\w-])[^"`]*\1?/.test(s) && /role="dialog"/.test(s))));
const missing = roots.filter(([, s]) => !(/modal-header/.test(s) && /modal-body/.test(s) && (/modal-footer/.test(s) || /<ModalFooter\b/.test(s))))
  .map(([f]) => f.slice(root.length));
ck(`all ${roots.length} dialogs have a header, a body and a footer from the shell`, roots.length >= 10 && missing.length === 0, missing);
// ⚠️ ONE FOOTER, NOT A CONVENTION (2.496.263). Eight dialogs wrote the
// `<span />`-then-Close markup by hand, and the check above accepted either
// form. Now only the shared footer writes it — bar the dialogs whose footer is
// an ANSWER rather than an exit (AskDialog's choices, a form's Cancel ·
// Submit), reviewed and listed here.
const OWN_FOOTER = new Set(["components/common/ModalFooter.tsx", "components/common/AskDialog.tsx",
  "components/fm/FaultStageModal.tsx", "components/fm/GuestReportModal.tsx"]);
const handFooters = tsx.filter(([, s]) => /className="modal-footer"/.test(s)).map(([f]) => f.slice(root.length).replace(/^src\//, "")).filter((f) => !OWN_FOOTER.has(f));
ck("no dialog writes the footer markup itself — it renders <ModalFooter>", handFooters.length === 0, handFooters);
const cornerX = roots.filter(([, s]) => /modal-header[\s\S]{0,300}aria-label="Close"/.test(s)).map(([f]) => f.slice(root.length));
ck("no dialog hides its exit as a corner ✕ — Close is in the footer, as everywhere", cornerX.length === 0, cornerX);

const allCss = css.map(([, s]) => noComments(s)).join("\n");
// ONE FRAME, ITS HEIGHT ITS KIND'S (architecture review O, 2026-10-27): every window says what it is
// (components/common/Window) and its height is that kind's one rule — it was a list of exceptions each window had to
// join, and "every window drawn over the whole screen" was the same edit in twelve files.
const KIND = { "components/common/AskDialog.tsx": '"question"', "components/panels/BadgeColorModal.tsx": '"question"',
  "components/fm/FaultStageModal.tsx": '"device"', "components/hud/AnnouncementNotice.tsx": '"screen"', "components/panels/BasePanel.tsx": '{entityId ? "device" : "content"}' };
const windows = tsx.filter(([f, s]) => /<Window\b/.test(s)).map(([f, s]) => [f.slice(root.length), s]);
const kindOf = (s) => /<Window kind=(\{[^}]*\}|"\w+")/.exec(s)?.[1];
const wrongKind = windows.filter(([f, s]) => kindOf(s) !== (KIND[f] ?? '"content"')).map(([f, s]) => [f, kindOf(s)]);
ck(`every window is drawn by the one frame, with its kind (${windows.length} windows)`, windows.length >= 11 && wrongKind.length === 0, wrongKind);
const byHand = tsx.filter(([f, s]) => !f.endsWith("components/common/Window.tsx") && /<DialogLayer\b/.test(s) && !/superadmin-prompt/.test(s))
  .map(([f]) => f.slice(root.length));
ck("  ...and none builds its own (the superadmin code's prompt is not a window: its own small card)", byHand.length === 0, byHand);
const drawn = (kind) => draw(h(Window, { kind, label: "X", onClose() {}, className: "settings-modal" }, h("p", null, "body")));
const card = (kind) => /class="(modal [^"]*)" role="dialog" aria-modal="true" aria-label="X"/.exec(drawn(kind))?.[1];
ck("the frame: a backdrop, a card named for a screen reader, its kind on it",
   ["content", "device", "question"].every((k) => card(k) === `modal window-${k} settings-modal` && /class="modal-backdrop"/.test(drawn(k))),
   ["content", "device", "question"].map(card));
// a tap inside the card never reaches the backdrop (which closes): the drawn markup keeps no handler, so read the frame
const frame = readFileSync(join(root, "components/common/Window.tsx"), "utf8");
ck("  ...a tap on the backdrop closes it, a tap inside the card does not",
   /<DialogLayer className=\{`modal-backdrop[^\n]*\} onClick=\{onClose\}\n/.test(frame)
   && /className=\{`modal window-\$\{kind\}[^\n]*\} style=\{style\}\s+onClick=\{\(e\) => e\.stopPropagation\(\)\} role="dialog"/.test(frame));
ck("a window of content has ONE fixed height on a tablet; a device's own window, a question box and the colour picker keep theirs",
   /\.modal\.window-content \{ height: 90vh; \}/.test(allCss) && !/(^|[^-])height: 90vh/.test(allCss.replace(/\.modal\.window-content \{ height: 90vh; \}/, ""))
   && !tsx.some(([, s]) => /modal-fixed-height/.test(s)) && !/\.modal-fixed-height/.test(allCss) && !/device-details|:not\(\.ask-dialog\)/.test(allCss));
ck("  ...and on a phone: the device lists one height, every other window of content the full screen, the others theirs",
   /max-height: 80dvh;[\s\S]{0,120}height: 80dvh;/.test(allCss)
   && /\.modal\.window-content:not\(\.panel-modal\) \{ height: 100dvh; \}/.test(allCss)
   && /\.modal\.panel-modal\.window-device, \.modal\.panel-modal\.window-question \{ height: auto; \}/.test(allCss));

// owner, 2026-10-22: Settings' footer "differs from the other modals" — one footer: every button one size, the one
// exit in the same group as Save and Cancel, the primary answer on the right
{
  const mf = readFileSync(new URL("../../src/components/common/ModalFooter.tsx", import.meta.url), "utf8");
  ck("ONE footer: every footer button one size, the Close in the same group as Save and Cancel, the primary on the right",
     /\.modal-footer \.btn \{[^}]*min-height: var\(--touch-min\)/.test(top)
     && /<div className="modal-footer-actions">\s*\{actions \?\? <button className="btn primary" onClick=\{onClose\}>/.test(mf)
     && mf.indexOf('aria-label="Cancel"') < mf.indexOf('className="btn primary"\n            disabled'));
}

// owner, 2026-10-24: Advanced Settings "remove the Close button … show the same Back button … consistent with other
// modals" — its way out is the header's Back (the device windows' own, common/BackButton), the model's controls sit
// where Close was
{
  const ce = readFileSync(new URL("../../src/components/settings/ConfigEditorModal.tsx", import.meta.url), "utf8");
  const bp = readFileSync(new URL("../../src/components/panels/BasePanel.tsx", import.meta.url), "utf8");
  ck("Advanced Settings: Back at its footer's left, where Settings' opener is; Upload Model and Log Out All at its header's right; no Close",
     /<ModalFooter onClose=\{back\} commit=\{commit\} back=\{\{ go: exit, to: withinSettings \? "Settings" : undefined \}\}\s*actions=\{withinSettings \? <span \/> : undefined\} \/>/.test(ce)
     && /<HeaderActions glbUpload=\{canUploadModel \? glbUpload : null\} logout=\{roleCan\(role, "editConfig"\) && <LogoutAll \/>\} \/>/.test(ce));
  // owner, 2026-10-25: ONE (i) at the header's right for both buttons, each a .btn whose word hides on a phone; the
  // upload no longer in the footer, where Cancel / Save pushed it left. Drawn (screen.mjs), not read from the source.
  const { h, draw } = await import("../consistency/screen.mjs");
  const header = (await import("@/components/settings/ConfigEditorModal")).HeaderActions;
  const up = { addonCfg: { model_path: "x.glb" }, loadedModel: null, openPicker() {}, uploadBusy: null, progress: {} };
  const logout = h("button", { className: "btn" }, h("span", { className: "btn-label" }, "Log Out All"));
  const both = draw(h(header, { glbUpload: up, logout }));
  const tipText = draw(h("div", {}, header({ glbUpload: up, logout }).props.children.at(-1).props.children));
  const tips = both.match(/class="info-btn"/g) ?? [];
  ck("  ...one (i) for Upload Model and Log Out All, after both buttons",
     tips.length === 1 && /Upload Model[\s\S]*Log Out All[\s\S]*class="info-btn"/.test(both), both.slice(0, 600));
  ck("  ...its words cover both", /<strong>Upload Model<\/strong>/.test(tipText) && /<strong>Log Out All<\/strong> signs every device out/.test(tipText));
  ck("  ...Upload Model is a .btn with a .btn-label word (hidden on a phone), like Log Out All",
     /<button class="btn"[^>]*>[\s\S]*?<span class="btn-label">Upload Model<\/span>/.test(both)
     && /<button className="btn" onClick=\{\(\) => setConfirming\(true\)\} aria-label="Log Out All">\s*<LogOut size=\{18\} aria-hidden \/><span className="btn-label">Log Out All<\/span>/.test(ce));
  ck("  ...the upload has left the footer", !/actions=\{canUploadModel/.test(ce) && !/header-icon-btn/.test(ce));
  const CentralModelInfo = (await import("@/components/settings/CentralModelInfo")).default;
  const tip = draw(h("div", {}, h(CentralModelInfo, { addonCfg: { model_path: "x.glb" }, loadedModel: null })));
  ck("  ...its words send to Upload Model beside it, never to a top bar that has no such button",
     /Upload Model, beside this \(i\)/.test(tip) && !/top bar/i.test(tip), tip.slice(-300));
  const css = readFileSync(new URL("../../src/styles/08-shared.css", import.meta.url), "utf8");
  ck("  ...on a phone the header's worded buttons go square, like the footer's",
     /\.modal-footer \.btn:has\(> \.btn-label\),\s*\.modal-header-actions \.btn:has\(> \.btn-label\) \{ width: var\(--touch-min\); padding: 0; \}/.test(css));
  ck("  ...the same Back component as a device window's", /<BackButton onClick=\{back\.go\} label=\{back\.label\} \/>/.test(bp)
     && !/className="btn panel-back"/.test(bp + ce));
}

if (fail) { console.log(`\n❌ ${fail} failed`); process.exit(1); }
console.log("\n✅ one modal shell");
