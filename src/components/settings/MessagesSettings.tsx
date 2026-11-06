// src/components/settings/MessagesSettings.tsx
// Settings › Messages › "Full-screen announcements", the villa's part (ticket 16 of "One inbox", owner 2026-10-28;
// the rule: messages/announcements noticeFor): the announcements that take the whole screen, picked from what the villa
// has announced, each with its own seconds (owner, 2026-11-03). Settings draws it under this tablet's own switch, for a
// profile that may edit the villa's setup, and owns its writes (its one draft: Save keeps them, Cancel puts them back).

import { FIELD_COMMIT_MS, usePendingField } from "@/hooks/usePendingField";
import { FULL_SCREEN_S_DEFAULT, fullScreenSecondsOk, type AppConfig, type FullScreenAnnouncement } from "@/config/AppConfig";
import { announcedTitles } from "@/messages/announcements";
import { useAnnouncements } from "@/messages/AnnouncementsContext";
import SearchPicker from "@/components/common/SearchPicker";
import AddOnLine from "@/components/common/AddOnLine";
import UnitField from "@/components/common/UnitField";
import RecordCard from "@/components/fm/RecordCard";
import CardField from "./CardField";
import { Maximize } from "lucide-react";

interface Props {
  /** The picked announcements as the dialog shows them (its draft's view). */
  value: readonly FullScreenAnnouncement[];
  /** Write a new list, as the dialog writes (its draft). */
  onChange: (next: FullScreenAnnouncement[]) => void;
}

/** The picked announcements, one card each (its title; its seconds; its bin), and a picker of the titles the add-on keeps
 *  (the page's one list). A title no longer kept stays picked until its ✕: the villa may announce it again. A newly
 *  picked one starts at FULL_SCREEN_S_DEFAULT. */
export function FullScreenAnnouncements({ value, onChange }: Props) {
  // the page's one list of what the add-on keeps (messages/AnnouncementsContext): never a read of its own (review Q
  // round 2: the tab read the add-on again when it opened)
  const { villa: kept, loaded } = useAnnouncements();
  const offered = announcedTitles(kept, value.map((f) => f.title));
  return (
    <>
      {/* ⚠️ ITS TITLE AND ITS ADD ON ONE LINE ABOVE THE CARD, THE CARD'S HEAD ITS COLUMNS' WORDS ONLY (owner, 2026-11-06:
          the add button sat in the head beside "Seconds", over two lines on a phone): the list's add is where every
          list's is (common/AddOnLine: Schedule's "Add a task", Who gets the messages' "Add a chat"), "Time" over the
          time, nothing over the ✕ */}
      <AddOnLine title={<span className="settings-list-title">On every tablet</span>} label="Add an announcement" words="Add">
        {(done) => <SearchPicker compact startOpen placeholder="Add an announcement…"
          onPick={(t) => { done(); onChange([...value.filter((x) => x.title !== t), { title: t, seconds: FULL_SCREEN_S_DEFAULT }]); }}
          rows={(q) => offered.filter((t) => t.toLowerCase().includes(q.trim().toLowerCase())).map((t) => ({ key: t, label: t }))}
          empty={offered.length > 0 ? undefined : !loaded ? "Reading what the villa has announced…"
            : "Nothing else announced yet: each announcement the villa makes is listed here."} />}
      </AddOnLine>
      {/* ⚠️ EACH ANNOUNCEMENT THE COCKPIT'S CARD (owner, 2026-11-06): its title in the strip, its time on screen its
          one field, its bin at its strip's right; it was a row of a table under "Announcement · Time" */}
      {value.length === 0 ? <p className="muted body-text">None yet: add one above.</p> : (
        <div className="fm-list settings-cards">
          {value.map((f) => (
            <FullScreenCard key={f.title} item={f} onRemove={() => onChange(value.filter((x) => x.title !== f.title))} />
          ))}
        </div>
      )}
    </>
  );
}

/** What typing `text` in `title`'s seconds writes: that one item's seconds, on the list as it is when the write lands
 *  (a title added meanwhile stays); null while it is not an accepted time (fullScreenSecondsOk: the field falls back).
 *  Pure: tests/oracles/messages_settings.mjs. */
export function secondsWrite(title: string, text: string): ((c: AppConfig) => Partial<AppConfig>) | null {
  const n = Number(text);
  if (text.trim() === "" || !fullScreenSecondsOk(n)) return null;
  return (c) => ({ fullScreen: c.fullScreen.map((f) => (f.title === title ? { ...f, seconds: n } : f)) });
}

/** One picked announcement: its title, how many seconds it fills the screen, its bin. The seconds commit on blur, Enter
 *  or a pause, in the dialog's one pending store (usePendingField). */
function FullScreenCard({ item, onRemove }: { item: FullScreenAnnouncement; onRemove: () => void }) {
  const field = usePendingField<string>(`fullScreen:${item.title}`, FIELD_COMMIT_MS);
  return (
    <RecordCard title={item.title} lead={<Maximize size={16} aria-hidden />}
      body={
        <CardField label="On screen">
          {/* the seconds and their unit joined, "10s" (owner, 2026-11-06: a box and a separate "s"; rules: durations
              are joined), in one field (common/UnitField) */}
          <UnitField unit="s">
            <input
              inputMode="numeric" aria-label={`Seconds ${item.title} fills the screen`}
              value={field.shown ?? String(item.seconds)}
              onChange={(e) => field.draft(e.target.value, secondsWrite(item.title, e.target.value))}
              onBlur={field.flush}
              onKeyDown={(e) => e.key === "Enter" && field.flush()}
            />
          </UnitField>
        </CardField>
      }
      remove={{ icon: "bin", label: `Delete the announcement ${item.title}`, run: onRemove }} />
  );
}
