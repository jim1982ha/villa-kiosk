// src/components/settings/FlagTypesPanel.tsx
//
// What the villa has been taught to raise more, or less, readily.
//
// ⚠️ THE THUMB BUTTONS PROMISED THIS FOR MONTHS AND NOTHING KEPT IT. Their
// tooltips have always read "the villa raises this kind more readily" / "…less
// readily", while the only thing a verdict did was count toward silencing ONE
// device after three dismissals. This panel is where the other half became
// visible (2026-08-28, owner's request): every kind a thumb has been pressed
// on, what it is worth, and the four things a person may do about it.
//
// ⚠️ A KIND IS A MEASUREMENT AND A DIRECTION, NEVER A DEVICE — the owner's
// explicit instruction, and `agent/flagtypes.py` is the authority. So a row
// here reads "Data rate above baseline", not "Living Room NVR": one press
// teaches every camera in the villa and every camera installed after it.
//
// ⚠️ AND IT IS A RE-RANKING, NOT A MUTE, WHICH THE COPY HAS TO SAY OUT LOUD.
// An owner turning a kind down to 0.1 will reasonably assume they have
// switched something off; they have not, and a screen that let them believe it
// would be the one that hides a frozen pipe behind a summer nuisance. The hint
// says the floor is 0.1 and never zero, which is the mechanism rather than a
// reassurance.
//
// ⚠️ THE NUMBER ON SCREEN **IS** THE MULTIPLIER (owner's design, and it
// replaced my first cut). That version stored an integer score and printed a
// sentence translating it — "ranked at a third of its novelty" — which is a
// number that cannot be read without a gloss. Theirs: "1.1 is promoted by 10%,
// 0.8 is demoted by 20%, and each click on the +/- button increases the weight
// index by 0.1". Nothing is derived, so nothing can drift.

import { useCallback, useEffect, useRef, useState } from "react";
import { Download, Loader2, Minus, Plus, Trash2, Upload } from "lucide-react";

import InfoHint from "@/components/common/InfoHint";
import { loadFlagTypes, tuneFlagTypes,
         type FlagTypeWeight } from "@/agent/agentApi";
import { hasCapability } from "@/auth/permissions";
import { useProfile } from "@/auth/ProfileContext";
import { downloadFile } from "@/utils/download";

/* ⚠️ `effectOf` WAS DELETED HERE (2026-08-28, owner: "I feel this is redundant
 * information and confusing the user"). It rendered "raised 20% less readily"
 * beside 0.8 — a sentence restating the number it sat next to. It was written
 * one release after the same owner replaced an integer score WITH that number
 * precisely so no sentence would be needed, so it re-created the problem the
 * redesign removed, in smaller type. The percentage still exists where it
 * belongs: in the (i), which explains the scale once instead of on every
 * row. */

export default function FlagTypesPanel() {
  const { role } = useProfile();
  const mayEdit = role != null && hasCapability(role, "editConfig");
  const [rows, setRows] = useState<FlagTypeWeight[] | null>(null);
  const [bounds, setBounds] = useState({ min: 0.1, max: 3, step: 0.1 });
  const [busy, setBusy] = useState("");
  const [note, setNote] = useState("");
  const fileRef = useRef<HTMLInputElement | null>(null);

  const load = useCallback(async () => {
    const out = await loadFlagTypes();
    setRows(out.types);
    setBounds({ min: out.min, max: out.max, step: out.step });
  }, []);
  useEffect(() => { void load(); }, [load]);

  const send = useCallback(async (
    body: Parameters<typeof tuneFlagTypes>[0], working: string,
  ) => {
    setBusy(working);
    setNote("");
    const out = await tuneFlagTypes(body);
    setBusy("");
    if (!out.ok) { setNote(out.reason || "That did not work."); return; }
    setRows(out.types);
  }, []);

  /** ⚠️ EXPORTED AS THE STORE'S OWN SHAPE, `{types: {key: {...}}}`, which is
   *  exactly what the import path validates and rebuilds. A bespoke export
   *  format would be a second contract between two files in two languages —
   *  the shape of defect this repository has paid for twice. */
  const exportList = useCallback(() => {
    const doc = {
      types: Object.fromEntries((rows ?? []).map((r) => [r.key, {
        factor: r.factor, up: r.up, down: r.down,
        label: r.label, first_at: r.firstAt, last_at: r.lastAt,
      }])),
    };
    downloadFile("vesta-priorities.json", JSON.stringify(doc, null, 2),
                 "application/json");
  }, [rows]);

  const importList = useCallback(async (file: File) => {
    setNote("");
    let parsed: unknown;
    try {
      parsed = JSON.parse(await file.text());
    } catch {
      // ⚠️ REFUSED HERE RATHER THAN POSTED. An unparseable file would reach the
      // server as `null` and come back "expected an object of flag types",
      // which describes OUR request rather than THEIR file.
      setNote("That file is not readable JSON.");
      return;
    }
    await send({ action: "import", document: parsed }, "import");
  }, [send]);

  if (rows === null) {
    return (
      <p className="muted body-text">
        <Loader2 size={14} className="spin" aria-hidden /> Loading…
      </p>
    );
  }

  return (
    <>
      <div className="settings-section-title">What to raise more, or less</div>
      <p className="muted body-text">
        Every kind of finding you have judged with a thumb, and how readily the
        villa raises it now.
        <InfoHint label="How this works">
          <p>
            A kind is a <strong>measurement and a direction</strong> — “energy
            above baseline”, “temperature below baseline” — never a particular
            device. So judging one concern teaches the villa about every device
            that measures the same thing, including ones installed later.
          </p>
          <p>
            The number is a <strong>multiplier</strong>. 1.0 is untouched, 1.1
            raises that kind 10% more readily, 0.8 raises it 20% less. Each
            press of + or − moves it by 0.1, and a thumb on a concern moves it
            by the same step.
          </p>
          <p>
            Turning a kind down never switches it off. It moves that kind down
            the list each check reads, so an ordinary day’s example may not
            reach you while an extreme one still will — the dial stops at 0.1
            and never reaches zero, so nothing here can hide an emergency.
          </p>
          <p>
            Removing a row is not the same as setting it back to 1.0: 1.0 means
            you have judged this kind and found it neutral, removed means the
            villa has never been told anything about it.
          </p>
          <p>
            A kind is recorded when a concern is <strong>raised</strong>, not
            when you judge it — the villa keeps only an anonymous reference to
            the device afterwards, so there is nothing left to work the kind
            out from. Concerns raised before this feature existed carry no
            kind, so judging one records your verdict and teaches nothing.
          </p>
        </InfoHint>
      </p>

      {rows.length === 0 ? (
        /* ⚠️ AN EMPTY LIST IS A STATE, NOT A FAULT, AND SAYS WHICH. A blank
           panel here reads as broken; the villa simply has not been taught
           anything yet, and the sentence says exactly how to teach it. */
        /* ⚠️ IT SAYS WHY IT IS EMPTY, AND THE SECOND SENTENCE IS THE ONE
           THAT MATTERS (reported: "i don't see anything in this section: is
           that expected?"). A kind is stamped when a concern is RAISED,
           because a stored concern keeps only a hash of its device — so
           thumbing a concern that predates this feature records the verdict
           and teaches nothing, and the list stays empty in a way that looks
           exactly like a broken screen. Saying so is the whole fix; the
           alternative was inventing a kind from a hash, which cannot be
           done. */
        <p className="muted body-text">
          Nothing judged yet. Press a thumb on a concern raised{" "}
          <strong>after this update</strong> and its kind appears here.
        </p>
      ) : (
        <ul className="fm-list">
          {rows.map((r) => (
            <li className="editable-row" key={r.key}>
              {/* ⚠️ THE LABEL AND THE NUMBER, AND NOTHING ELSE (owner,
                  2026-08-28). This row carried two extra things and both were
                  wrong to be here. "raised 20% less readily" TRANSLATED 0.8
                  into words — but the whole reason the store holds a
                  multiplier rather than a score is that the number needs no
                  translation, so the gloss argued against its own design.
                  "0 useful, 2 not" was the thumb tally, kept on the reasoning
                  that a neutral value is reached both by never judging and by
                  judging once each way; under a multiplier a row only EXISTS
                  once judged, so the row's presence already says it.

                  ⚠️ THE TALLY IS NOT DELETED, IT IS MOVED. It is real stored
                  data and it rides the export; it sits in the row's tooltip,
                  where a reader who wants it can find it and a reader
                  scanning the list is not charged for it. */}
              <div className="editable-row-fields">
                <span className="body-text"
                      title={`${r.up} useful, ${r.down} not useful`}>
                  {r.label}
                </span>
              </div>
              {mayEdit && (
                <>
                  {/* ⚠️ THE VALUE IS TEXT AND THE CONTROLS ARE TWO BUTTONS —
                      the owner's own sketch, and it replaced a number field.
                      A typed field on a wall-mounted tablet raises the
                      keyboard over the list you are editing, and it accepts
                      1.15 and 40 and "abc", each of which then has to be
                      argued with. Two buttons can only ever produce a value
                      the store already allows.

                      ⚠️ AND THE BUTTONS SEND A DIRECTION, NOT A NUMBER. The
                      step lives in `flagtypes.STEP` alone; a client computing
                      `factor + 0.1` would be a second implementation of the
                      arithmetic, and 0.1 is exactly the value that does not
                      survive binary floating point unrounded. */}
                  <span className="body-text flag-factor"
                        aria-label={`Multiplier for ${r.label}`}>
                    {r.factor.toFixed(1)}
                  </span>
                  <button
                    type="button" className="icon-btn" disabled={busy !== ""}
                    aria-label={`Raise ${r.label} more readily`}
                    title={`Raise this kind more readily (+${bounds.step
                      .toFixed(1)}, up to ${bounds.max.toFixed(1)})`}
                    onClick={() => void send(
                      { action: "nudge", key: r.key, direction: "up" }, r.key)}
                  >
                    <Plus size={16} aria-hidden />
                  </button>
                  <button
                    type="button" className="icon-btn" disabled={busy !== ""}
                    aria-label={`Raise ${r.label} less readily`}
                    title={`Raise this kind less readily (−${bounds.step
                      .toFixed(1)}, down to ${bounds.min.toFixed(1)} — it is `
                      + `never switched off entirely)`}
                    onClick={() => void send(
                      { action: "nudge", key: r.key, direction: "down" }, r.key)}
                  >
                    <Minus size={16} aria-hidden />
                  </button>
                  {/* ⚠️ `btn danger icon-only`, NOT `.icon-btn`, AND THE PIN
                      CAUGHT THIS ONE. Removing a row here discards a
                      preference a person expressed by hand and cannot be
                      undone from this screen, so it takes the destructive
                      treatment every other row delete in the app uses —
                      `test_editable_rows` derives the rule from the markup
                      rather than from a list of files, so a new caller is
                      covered on the day it is written. */}
                  <button
                    type="button" className="btn danger icon-only"
                    disabled={busy !== ""}
                    aria-label={`Remove ${r.label}`}
                    title="Forget this kind — back to never having been judged"
                    onClick={() => void send({ action: "forget", key: r.key },
                                             r.key)}
                  >
                    <Trash2 size={16} aria-hidden />
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      {note && <p className="body-text sev-warning" role="status">{note}</p>}

      {mayEdit && (
        <div className="modal-actions" style={{ flexWrap: "wrap" }}>
          <button type="button" className="btn ghost" disabled={busy !== ""}
                  onClick={exportList}
                  title="Save this list to a file — carry it to another villa, or keep it as a backup">
            <Download size={16} aria-hidden />
            <span className="btn-label">Export</span>
          </button>
          <button type="button" className="btn ghost" disabled={busy !== ""}
                  onClick={() => fileRef.current?.click()}
                  title="Load a saved list, replacing what is here">
            <Upload size={16} aria-hidden />
            <span className="btn-label">Import</span>
          </button>
          {/* ⚠️ HIDDEN VIA THE GLOBAL `[hidden]` GUARD, NOT `display:none` HERE.
              A file input inside a styled form field has reappeared as a stray
              "Choose files" control in this app before — `styles.css` carries
              `[hidden]{display:none !important}` as the one owner of that. */}
          <input ref={fileRef} type="file" accept="application/json" hidden
                 onChange={(e) => {
                   const f = e.target.files?.[0];
                   e.target.value = "";
                   if (f) void importList(f);
                 }} />
          <button type="button" className="btn danger"
                  disabled={busy !== "" || rows.length === 0}
                  onClick={() => void send({ action: "clear" }, "clear")}
                  title="Forget every kind — the villa goes back to raising everything as it comes">
            <Trash2 size={16} aria-hidden />
            <span className="btn-label">Clear all</span>
          </button>
        </div>
      )}
    </>
  );
}
