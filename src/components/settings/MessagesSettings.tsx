// src/components/settings/MessagesSettings.tsx
// How the villa's announcements show (ticket 16 of "One inbox", owner 2026-10-28; the rule: messages/announcements
// noticeFor). Advanced Settings › Messages, the villa's: "Full screen for" (the titles that take the whole screen,
// picked from what the villa has announced) and "Ring shown for". Settings › Messages, this tablet's: "Rings full
// screen on this tablet".

import { useConfig } from "@/config/ConfigContext";
import { FIELD_COMMIT_MS, usePendingField } from "@/hooks/usePendingField";
import { ringShownForOk } from "@/config/AppConfig";
import { announcedTitles } from "@/messages/announcements";
import { useAnnouncements } from "@/messages/AnnouncementsContext";
import RemovablePill from "@/components/common/RemovablePill";
import SearchPicker from "@/components/common/SearchPicker";
import { withItem } from "@/utils/listToggle";

/** "Full screen for": the picked titles as pills, and a picker of the titles the add-on keeps (the page's one list). A title no longer kept stays picked until its ✕: the villa may announce it again. */
export function FullScreenFor() {
  const { config, update } = useConfig();
  const picked = config.fullScreenFor;
  // the page's one list of what the add-on keeps (messages/AnnouncementsContext): never a read of its own (review Q
  // round 2: the tab read the add-on again when it opened)
  const { villa: kept, loaded } = useAnnouncements();
  const set = (title: string, on: boolean) => update({ fullScreenFor: withItem(picked, title, on) });
  const offered = announcedTitles(kept, picked);
  return (
    <div className="row" style={{ flexWrap: "wrap", gap: 6, alignItems: "center" }}>
      {picked.map((t) => (
        <RemovablePill key={t} label={t} removeLabel={`Take ${t} off full screen`} onRemove={() => set(t, false)} />
      ))}
      <div style={{ flex: "1 1 220px", minWidth: 160 }}>
        <SearchPicker compact placeholder="Add an announcement…" onPick={(t) => set(t, true)}
          rows={(q) => offered.filter((t) => t.toLowerCase().includes(q.trim().toLowerCase())).map((t) => ({ key: t, label: t }))}
          empty={offered.length > 0 ? undefined : !loaded ? "Reading what the villa has announced…"
            : "Nothing else announced yet: each announcement the villa makes is listed here."} />
      </div>
    </div>
  );
}

/** "Ring shown for": how long a full-screen announcement holds the screen, in whole seconds. Commits on blur/Enter or
 *  after a pause; a value out of range commits nothing and the field falls back to the stored one. */
export function RingShownFor() {
  const { config } = useConfig();
  const field = usePendingField<string>("ringShownForS", FIELD_COMMIT_MS);
  const write = (text: string) => {
    const n = Number(text);
    return text.trim() !== "" && ringShownForOk(n) ? { ringShownForS: n } : null;
  };
  return (
    <div className="settings-field-row">
      <label htmlFor="ring-shown-for">Ring shown for, in seconds</label>
      <input
        id="ring-shown-for" inputMode="numeric" className="field-narrow"
        value={field.shown ?? String(config.ringShownForS)}
        onChange={(e) => field.draft(e.target.value, write(e.target.value))}
        onBlur={field.flush}
        onKeyDown={(e) => e.key === "Enter" && field.flush()}
      />
    </div>
  );
}
