// src/components/fm/TaskCard.tsx
// A maintenance task's card, ONE for the Today tab and the Schedule tab.
//
// ⚠️ ONE TASK, ONE CARD (architecture review, 2026-11-05, after the "Status on top" card): each tab drew the task by
// itself, so the same overdue task was a red "Overdue" card on Today and a grey card with no state on Schedule, and only
// Today said who last did it. Only the buttons are the tab's.

import type { ReactNode } from "react";
import { DUE_WORDS, shortDate, workedBy, type ScheduleStatus } from "@/fm/fmEngine";
import { momentText } from "@/utils/dateText";
import { pillClass, toneClass, type Tone } from "@/fm/tone";
import AgentMark from "./AgentMark";
import RecordCard from "./RecordCard";

/** Where a task stands: paused, else how its due date stands (fmEngine.DUE_WORDS, the recap's words too). */
export function taskState(st: Pick<ScheduleStatus, "schedule" | "state">): { word: string; tone: Tone } {
  return st.schedule.enabled ? DUE_WORDS[st.state] : { word: "Paused", tone: "warn" };
}

export default function TaskCard({ status: st, room, actions }: {
  status: ScheduleStatus; room?: string; actions: ReactNode;
}) {
  const s = taskState(st);
  return (
    // the day it is due in its strip, its interval on its quiet line, the last time it was done its who line
    // (the "Status on top" card, owner 2026-11-05)
    <RecordCard tone={toneClass(s.tone)} title={st.schedule.title}
      status={{ text: s.word, tone: pillClass(s.tone) }}
      when={st.dueAt ? `Due ${shortDate(st.dueAt)}` : undefined}
      who={st.last ? `Last done by ${workedBy(st.last)}, on ${momentText(st.last.at)}` : null}
      room={room}
      pills={<>
        <span>every {st.schedule.everyDays} days</span>
        {st.schedule.clause && <span className="fm-clause">Cl. {st.schedule.clause}</span>}
        <AgentMark record={st.schedule} />
      </>}
      actions={actions} />
  );
}
