// src/components/cockpit/SupervisionTab.tsx
//
// The agent's workflow, as a workflow. Everything the supervision layer is
// doing, in the order it does it.
//
// ⚠️ THESE FIVE BLOCKS LIVED MID-SCROLL INSIDE THE COCKPIT TAB, AND THAT TAB IS
// ABOUT DEVICES. Between "Needs attention" (read straight from Home Assistant)
// and an energy chart sat the entire reasoning pipeline — the approval queue,
// the concerns, the proposals, the review drafts and the villa's memories —
// five sections answering a completely different question from the ones either
// side of them. The owner's report was blunt and correct: they could not find
// where Concerns were shown, and asked twice. They were on screen the whole
// time, fourth of nine sections in a tab whose subject is equipment.
//
// ⚠️ THE SPLIT IS BY QUESTION, NOT BY COMPONENT SIZE. Cockpit answers "how is
// the villa?" — state, read from Home Assistant and from what automations
// wrote. This answers "what is the supervision layer doing about it?" — which
// is inference, all of it, and every block here carries a source chip saying
// so. A reader who wants to know whether anything is wrong goes to one; a
// reader deciding whether to trust the agent goes to the other.
//
// ⚠️ AND THE ORDER IS THE PIPELINE, WHICH THE OLD LAYOUT INVERTED. Triage flags
// a subject, an investigation judges it, and only then is there anything to act
// on — but Proposals rendered ABOVE the queue that precedes them. That order
// was deliberate and defensible (blocking work first, and it is documented at
// each block), yet it taught the reader the stages in reverse. Here the stages
// run forward and the urgency is carried by the STAGE HEADINGS instead, which
// say what is blocked and on whom.
//
// ⚠️ NO CAPABILITY IS READ HERE. Every block owns its own check — the same rule
// `test_cockpit_is_gated_nowhere` protects for the Cockpit view, and for the
// same reason: this surface must be reachable by a profile that cannot act on
// any of it, because "what is the villa concluding about my property" is not a
// privileged question.

import CockpitConcerns from "./CockpitConcerns";
import CockpitMemories from "./CockpitMemories";
import CockpitProposals from "./CockpitProposals";
import CockpitQueue from "./CockpitQueue";
import CockpitReview from "./CockpitReview";
import SourceLegend from "@/components/common/SourceLegend";

export default function SupervisionTab() {
  return (
    <div className="fm-stack">
      {/* ── Stage 1 · flagged, not yet examined ───────────────────────────
          The cheap pass ranks subjects and stops. Nothing here has been
          diagnosed, and the list is not in priority order — a triage
          escalation carries no severity at all (ADR-021). */}
      <p className="muted body-text">
        This is what the villa is <em>reasoning</em> about — separate from the
        Cockpit, which is what it can simply see. Everything below is inference,
        and each block says whose.
      </p>

      <CockpitQueue />

      {/* ── Stage 2 · examined, with evidence ─────────────────────────────
          An investigation ran and reached a conclusion it can cite. This is the
          agent's counterpart to a Task: the deterministic pipeline writes a
          to-do item somebody ticks, and this pipeline writes a concern somebody
          acknowledges. Same stage of two engines — which is why the brief
          deduplicates them against each other by subject, preferring the
          blueprint while one still exists. */}
      <CockpitConcerns />

      {/* ── Stage 3 · blocked on a person ─────────────────────────────────
          An action the villa has stopped and will not take without an answer,
          and it expires. High harm is proposed and NEVER executed, at any
          confidence, from any trigger. */}
      <CockpitProposals />

      {/* A procedure the agent wrote and may not use until somebody approves
          it — a question about method rather than about the villa. */}
      <CockpitReview />

      {/* ── What it now believes ──────────────────────────────────────────
          Last, because a memory is not an event: it is an assertion the agent
          will carry into every later check, which is closer in kind to a
          procedure than to an alert. */}
      <CockpitMemories />

      {/* ⚠️ THE KEY, ON THE SCREEN WHERE THE MOST SOURCES APPEAR AT ONCE. The
          chips are the colour code and this is the footer the owner asked for;
          neither works alone, and on a wall-mounted tablet there is no hover to
          fall back on. It lists only the sources this tab can actually show — a
          key naming labels that appear nowhere sends the reader hunting. */}
      <SourceLegend only={["triage", "agent"]} />
    </div>
  );
}
