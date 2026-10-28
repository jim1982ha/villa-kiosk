// src/components/hud/AnnouncementNotice.tsx
// What the villa just announced — "🔔 Visitor at the gate · Someone is at the door." — on every tablet and phone, for
// ANNOUNCEMENT_NOTICE_MS, drawn as every notice is (Notice). Its own place in the column, above AppNotice's: a motion
// notice (the visitor walking up) must not replace the ring.

import { useEffect, useState } from "react";
import { Bell } from "lucide-react";
import { NoticeView } from "./Notice";
import {
  ANNOUNCEMENT_NOTICE_MS, fetchAnnouncements, pauseFor, watchAnnouncements, type Announcement,
} from "@/messages/announcements";

/** One announcement, drawn — pure (a check draws it): its title, then the first line of what it says. */
export function AnnouncementNoticeView({ announcement }: { announcement: Announcement }) {
  const said = announcement.text.split("\n")[0];
  return (
    <NoticeView tone="info" icon={<Bell size={16} />}>
      {said ? `${announcement.title} · ${said}` : announcement.title}
    </NoticeView>
  );
}

export default function AnnouncementNotice() {
  const [shown, setShown] = useState<Announcement | null>(null);

  useEffect(() => {
    const stop = new AbortController();
    // The newest of what arrived together: two rings in one read are one notice, the later.
    void watchAnnouncements(fetchAnnouncements, (items) => setShown(items[items.length - 1]), stop.signal, pauseFor);
    return () => stop.abort();
  }, []);

  useEffect(() => {
    if (!shown) return;
    const t = setTimeout(() => setShown(null), ANNOUNCEMENT_NOTICE_MS);
    return () => clearTimeout(t);
  }, [shown]);

  return shown ? <AnnouncementNoticeView announcement={shown} /> : null;
}
