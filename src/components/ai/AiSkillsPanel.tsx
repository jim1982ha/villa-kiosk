// src/components/ai/AiSkillsPanel.tsx
// Creating, editing, enabling and deleting the Skills the AI layer watches by.
//
// ⚠️ THE ANSWER TO "HOW CAN I ADD, EDIT, ACTIVATE ANY SKILL?" The plan's answer
// was: open a file-editor add-on and write Markdown. That is an answer for
// somebody who administers Home Assistant, not for a villa owner or a facility
// manager standing at a wall tablet — which is who this product is for.
//
// ⚠️ THE FILES ARE REAL NOW AND INERT UNTIL TICKET 27. The layer does not load
// Skills yet. Editing one here writes a file the engine will read the day it
// can, and this screen says so rather than implying something is watching.

import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, FilePlus2, Save, Trash2 } from "lucide-react";
import {
  TEMPLATE, deleteSkill, listSkills, readSkill, setEnabled, writeSkill,
  type SkillListing, type SkillMeta,
} from "@/ai/skillsApi";

const NAME_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export default function AiSkillsPanel() {
  const [listing, setListing] = useState<SkillListing | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [original, setOriginal] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setListing(await listSkills());
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const openSkill = async (path: string) => {
    setError(null);
    try {
      const content = await readSkill(path);
      setOpen(path);
      setDraft(content);
      setOriginal(content);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const save = async (content = draft) => {
    if (!open) return;
    setBusy(true);
    setError(null);
    try {
      await writeSkill(open, content);
      setOriginal(content);
      setDraft(content);
      await refresh();
    } catch (e) {
      // ⚠️ THE DIALOG STAYS OPEN ON A REFUSAL. A save that vanishes with the
      // editor is a save the operator believes happened.
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (skill: SkillMeta) => {
    setBusy(true);
    setError(null);
    try {
      const content = await readSkill(skill.path);
      await writeSkill(skill.path, setEnabled(content, !skill.enabled));
      if (open === skill.path) {
        const next = setEnabled(draft, !skill.enabled);
        setDraft(next);
        setOriginal(next);
      }
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (path: string) => {
    setBusy(true);
    setError(null);
    try {
      await deleteSkill(path);
      if (open === path) { setOpen(null); setDraft(""); setOriginal(""); }
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const create = async () => {
    const departments = listing?.departments ?? [];
    const dept = window.prompt(`Which department?\n${departments.join(", ")}`, departments[0]);
    if (!dept) return;
    const name = window.prompt("Name it (lower case, no spaces)", "");
    if (!name) return;
    if (!NAME_RE.test(name)) {
      setError("a name is lower-case letters, digits, dashes and underscores");
      return;
    }
    const path = `${dept}/${name}.md`;
    setBusy(true);
    setError(null);
    try {
      await writeSkill(path, TEMPLATE(name.replace(/[-_]/g, " ")));
      await refresh();
      await openSkill(path);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (loadError) {
    return (
      <div className="ai-empty">
        <div className="settings-section-title" style={{ marginTop: 0 }}>
          Skills unavailable
        </div>
        <p>{loadError}</p>
      </div>
    );
  }
  if (!listing) return <div className="ai-empty"><p>Reading…</p></div>;

  // ⚠️ "NO FOLDER" AND "NO SKILLS" ARE DIFFERENT SENTENCES. Only one of them is
  // something the owner can fix by writing a Skill.
  if (listing.root === null) {
    return (
      <div className="ai-empty">
        <div className="settings-section-title" style={{ marginTop: 0 }}>
          No Skills folder
        </div>
        <p>
          This add-on has no config folder mapped, so there is nowhere for Skills
          to live. {listing.error}
        </p>
      </div>
    );
  }

  const dirty = draft !== original;

  // ⚠️ MASTER AND DETAIL, NOT A LIST WITH AN EDITOR UNDER IT. The first cut
  // rendered the editor after the list inside a fixed-height scrolling body, so
  // opening a Skill appended a textarea below the fold with nothing to say it
  // had happened — the owner reasonably concluded there was no way to see or
  // edit one. Swapping the whole panel makes where you are unambiguous.
  if (open) {
    const meta = listing.skills.find((s) => s.path === open);
    return (
      <div className="ai-skills">
        <div className="ai-detail-head">
          <button
            type="button" className="btn ghost btn-small"
            onClick={() => {
              if (dirty && !window.confirm("Discard your changes to this Skill?")) return;
              setOpen(null);
              setError(null);
            }}
          >
            <ChevronLeft size={16} /> All skills
          </button>
          {meta && (
            <span className={`ai-pill ${meta.enabled ? "on" : "off"}`}>
              {meta.enabled ? "On" : "Off"}
            </span>
          )}
        </div>

        <div className="settings-section-title" style={{ marginTop: 0 }}>
          {meta?.title || open}
        </div>
        <p className="ai-note" style={{ marginTop: 0 }}>
          {open}{meta ? ` · ${meta.department}` : ""}
        </p>

        {error && <div className="ai-error" role="alert">{error}</div>}

        <textarea
          className="ai-editor-text"
          value={draft}
          spellCheck={false}
          onChange={(e) => setDraft(e.target.value)}
          aria-label={`Contents of ${open}`}
        />

        <div className="ai-detail-actions">
          {meta && (
            <button type="button" className="btn ghost" disabled={busy}
              onClick={() => void toggle(meta)}>
              {meta.enabled ? "Disable" : "Enable"}
            </button>
          )}
          <button
            type="button" className="btn ghost btn-danger" disabled={busy}
            onClick={() => { if (window.confirm(`Delete ${open}?`)) void remove(open); }}
          >
            <Trash2 size={16} /> Delete
          </button>
          <span style={{ flex: "1 1 auto" }} />
          <button
            type="button" className="btn primary"
            onClick={() => void save()} disabled={!dirty || busy}
          >
            <Save size={16} /> {dirty ? "Save" : "Saved"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="ai-skills">
      <div className="ai-notice">
        A starter set is installed. Open one to read or edit it. ⚠️ The layer
        does not <em>read</em> Skills yet — that arrives in a later release; what
        is here is kept, and anything you delete stays deleted.
      </div>

      <div className="ai-skills-head">
        <div className="settings-section-title" style={{ margin: 0 }}>
          {listing.skills.length} skill{listing.skills.length === 1 ? "" : "s"}
        </div>
        <button type="button" className="btn" onClick={() => void create()} disabled={busy}>
          <FilePlus2 size={16} /> New
        </button>
      </div>

      {error && <div className="ai-error" role="alert">{error}</div>}

      {listing.skills.length === 0 && (
        <p className="ai-note">
          Nothing here yet. A Skill is one short Markdown file describing
          something worth watching and what to say about it.
        </p>
      )}

      <ul className="ai-skill-list">
        {listing.skills.map((s) => (
          <li key={s.path}>
            {/* The WHOLE row opens it, and a chevron says so. The first cut
                made the name a bare button with no affordance at all. */}
            <button type="button" className="ai-skill-row" onClick={() => void openSkill(s.path)}>
              <span className={`ai-pill ${s.enabled ? "on" : "off"}`}>
                {s.enabled ? "On" : "Off"}
              </span>
              <span className="ai-skill-text">
                <span className="ai-skill-name">{s.title || s.name}</span>
                <span className="ai-skill-dept">{s.department}</span>
              </span>
              <ChevronRight size={18} className="ai-skill-chevron" aria-hidden />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
