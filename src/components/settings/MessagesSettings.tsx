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
import Tip from "@/components/common/Tip";
import AddOnLine from "@/components/common/AddOnLine";
import { X } from "lucide-react";

interface Props {
  /** The picked announcements as the dialog shows them (its draft's view). */
  value: readonly FullScreenAnnouncement[];
  /** Write a new list, as the dialog writes (its draft). */
  onChange: (next: FullScreenAnnouncement[]) => void;
}

/** The picked announcements, one row each (its title; its seconds; its ✕), and a picker of the titles the add-on keeps
 *  (the page's one list). A title no longer kept stays picked until its ✕: the villa may announce it again. A newly
 *  picked one starts at FULL_SCREEN_S_DEFAULT. */
export function FullScreenAnnouncements({ value, onChange }: Props) {
  // the page's one list of what the add-on keeps (messages/AnnouncementsContext): never a read of its own (review Q
  // round 2: the tab read the add-on again when it opened)
  const { villa: kept, loaded } = useAnnouncements();
  const offered = announcedTitles(kept, value.map((f) => f.title));
  return (
    <>
      {/* one card: its heading says the list is every tablet's, with its add, then a row per pick (owner, 2026-11-03:
          "very poorly rendered", the rows did not line up and "For every tablet" floated alone). ⚠️ THE HEADING IS A ROW'S
          COLUMNS (owner, 2026-11-04: "Seconds" stood over the ✕): the add on the heading's line at the title's right
          (common/AddOnLine), "Seconds" over the seconds, nothing over the ✕ */}
      <div className="settings-list" style={{ marginTop: 14 }}>
        <div className="settings-list-head fs-row">
          <AddOnLine title="Announcements, on every tablet" label="Add an announcement">
            {(done) => <SearchPicker compact startOpen placeholder="Add an announcement…"
              onPick={(t) => { done(); onChange([...value.filter((x) => x.title !== t), { title: t, seconds: FULL_SCREEN_S_DEFAULT }]); }}
              rows={(q) => offered.filter((t) => t.toLowerCase().includes(q.trim().toLowerCase())).map((t) => ({ key: t, label: t }))}
              empty={offered.length > 0 ? undefined : !loaded ? "Reading what the villa has announced…"
                : "Nothing else announced yet: each announcement the villa makes is listed here."} />}
          </AddOnLine>
          {/* the seconds cell drawn as a row's (its field's width, then its "s", unseen): the word stands over the field */}
          {value.length > 0 && <span className="fs-row-seconds"><span className="fs-head-seconds">Seconds</span><span className="fs-head-unit" aria-hidden>s</span></span>}
          {value.length > 0 && <span className="fs-head-remove" aria-hidden />}
        </div>
        {value.length === 0 && <div className="settings-list-row muted body-text">None yet: add one with +.</div>}
        {value.map((f) => (
          <FullScreenRow key={f.title} item={f} onRemove={() => onChange(value.filter((x) => x.title !== f.title))} />
        ))}
      </div>
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

/** One picked announcement: its title, how many seconds it fills the screen, its ✕. The seconds commit on blur, Enter or
 *  a pause, in the dialog's one pending store (usePendingField). */
function FullScreenRow({ item, onRemove }: { item: FullScreenAnnouncement; onRemove: () => void }) {
  const field = usePendingField<string>(`fullScreen:${item.title}`, FIELD_COMMIT_MS);
  const removeLabel = `Take ${item.title} off full screen`;
  return (
    <div className="settings-list-row fs-row">
      <span className="body-text fs-row-title">{item.title}</span>
      <span className="fs-row-seconds">
        <input
          inputMode="numeric" aria-label={`Seconds ${item.title} fills the screen`}
          value={field.shown ?? String(item.seconds)}
          onChange={(e) => field.draft(e.target.value, secondsWrite(item.title, e.target.value))}
          onBlur={field.flush}
          onKeyDown={(e) => e.key === "Enter" && field.flush()}
        />
        <span className="muted">s</span>
      </span>
      <Tip text={removeLabel}>
        <button type="button" className="btn ghost icon-btn-sm" aria-label={removeLabel} onClick={onRemove}>
          <X size={16} aria-hidden />
        </button>
      </Tip>
    </div>
  );
}
