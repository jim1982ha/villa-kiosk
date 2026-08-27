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
// An owner reading "raise this less readily" beside a minus number will
// reasonably assume they have switched something off; they have not, and a
// screen that let them believe it would be the one that hides a frozen pipe
// behind a summer nuisance. The hint states it in the words of the mechanism.

import { useCallback, useEffect, useRef, useState } from "react";
import { Download, Loader2, Trash2, Upload } from "lucide-react";

import InfoHint from "@/components/common/InfoHint";
import { loadFlagTypes, tuneFlagTypes,
         type FlagTypeWeight } from "@/agent/agentApi";
import { hasCapability } from "@/auth/permissions";
import { useProfile } from "@/auth/ProfileContext";

/** ⚠️ THE MULTIPLIER IS RESTATED FOR A READER, NOT RE-DECIDED. The arithmetic
 *  lives in `flagtypes.multiplier`; this only words it, the same way the
 *  escalation bands are mirrored on a concern card. A number with no meaning
 *  beside it ("weight -2") is an assertion; "ranked at a third of its novelty"
 *  is a sentence somebody can disagree with. */
function effectOf(weight: number): string {
  if (weight === 0) return "ranked as it comes";
  if (weight > 0) return `ranked ${weight + 1}× higher`;
  return `ranked at 1⁄${1 - weight} of its novelty`;
}

export default function FlagTypesPanel() {
  const { role } = useProfile();
  const mayEdit = role != null && hasCapability(role, "editConfig");
  const [rows, setRows] = useState<FlagTypeWeight[] | null>(null);
  const [limit, setLimit] = useState(5);
  const [busy, setBusy] = useState("");
  const [note, setNote] = useState("");
  const fileRef = useRef<HTMLInputElement | null>(null);

  const load = useCallback(async () => {
    const out = await loadFlagTypes();
    setRows(out.types);
    setLimit(out.limit);
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
        weight: r.weight, up: r.up, down: r.down,
        label: r.label, first_at: r.firstAt, last_at: r.lastAt,
      }])),
    };
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(doc, null, 2)], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "vesta-priorities.json";
    a.click();
    URL.revokeObjectURL(url);
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
            A minus score does not switch a kind off. It moves that kind down
            the list each check reads, so an ordinary day’s example may not
            reach you while an extreme one still will. Nothing here can hide an
            emergency.
          </p>
          <p>
            Removing a row is not the same as setting it to zero: zero means
            you have judged this kind and found it neutral, removed means the
            villa has never been told anything about it.
          </p>
        </InfoHint>
      </p>

      {rows.length === 0 ? (
        /* ⚠️ AN EMPTY LIST IS A STATE, NOT A FAULT, AND SAYS WHICH. A blank
           panel here reads as broken; the villa simply has not been taught
           anything yet, and the sentence says exactly how to teach it. */
        <p className="muted body-text">
          Nothing has been judged yet. Press a thumb on a concern in the Reason
          tab and the kind of finding it was appears here.
        </p>
      ) : (
        <ul className="fm-list">
          {rows.map((r) => (
            <li className="editable-row" key={r.key}>
              <div className="editable-row-fields">
                <span className="body-text">{r.label}</span>
                <span className="muted body-text">
                  {effectOf(r.weight)} · {r.up} useful, {r.down} not
                </span>
              </div>
              {mayEdit && (
                <>
                  {/* ⚠️ A NUMBER FIELD, NOT A PAIR OF ARROWS. The owner asked to
                      "edit the weightage in + or in -", and a stepper walks one
                      step per press — five presses to reach the floor, on a
                      wall tablet. The bounds come from the SERVER's own limit
                      rather than a literal here, so the two cannot disagree. */}
                  <input
                    type="number" inputMode="numeric" style={{ width: 76 }}
                    value={r.weight} min={-limit} max={limit} step={1}
                    disabled={busy !== ""}
                    aria-label={`Score for ${r.label}`}
                    onChange={(e) => void send(
                      { action: "weight", key: r.key,
                        weight: Number(e.target.value) },
                      r.key)}
                  />
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
