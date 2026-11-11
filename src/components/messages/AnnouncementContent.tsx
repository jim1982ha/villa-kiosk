// src/components/messages/AnnouncementContent.tsx
// An announcement's own parts, drawn the same wherever it shows: its buttons (the doorbell's Unlock, labels and
// commands the villa's) with what became of a press, its photos (PhotoRow), and its whole content (photos, words,
// bottom line, buttons) for
// the full screen and the Cockpit's Messages (ticket 17 of "One inbox"). The notice draws its one line with the same
// buttons (components/hud/AnnouncementNotice).

import { useState, type ReactNode } from "react";
import { FileText } from "lucide-react";
import { documentUrl } from "@/fm/fmApi";
import { CARD_BUTTON } from "@/components/fm/WorkButtons";
import { useProfileOrNull } from "@/auth/ProfileContext";
import { roleCan } from "@/auth/permissions";
import { useConfirmDialog, type Question } from "@/hooks/useConfirmDialog";
import { useAnnouncementPress } from "@/messages/AnnouncementsContext";
import { useConversation } from "@/messages/ConversationContext";
import { announcementPhotoUrl, offeredButtons, photoCaption, photoOrder, pressedRow, type Announcement, type AnnouncementButton,
  type AnnouncementPhoto, type Pressable } from "@/messages/announcements";
import PhotoLightbox from "@/components/fm/PhotoLightbox";
import type { PressState } from "@/messages/presses";

/**
 * ⚠️ AN ANNOUNCEMENT'S PHOTOS, ONE ROW (owner, 2026-11-06, "One visit, one story": every photo of the visit in the one
 * notification): each a thumbnail with its camera and time under it (photoCaption), in the record's order, the main
 * one first (the strongest signal's); a tap opens it full size in the one viewer (PhotoLightbox), the row's others a
 * swipe away. A photo the add-on refuses is hidden (review Q round 2): a guest is served only the current
 * notification's photos (supervisor-proxy.py _current_photo_names), so a page that read them while current drew empty
 * frames once they were not. `lead`: the main photo as large as the place allows, the others in a row under it (the
 * full screen). The same row on every screen: the notice, the full screen, the Inbox's card, an issue's, VESTA's
 * conversation. The visit's strongest step's photo (flagged by the VESTA Agent) leads the row, drawn about twice a tile's
 * size (owner, 2026-11-07), the others after it in time order; the notice keeps its small tiles (08-shared.css).
 * Pure: a check draws it.
 */
export function PhotoRow({ photos, lead = false }: { photos: readonly AnnouncementPhoto[]; lead?: boolean }) {
  const [refused, setRefused] = useState<ReadonlySet<string>>(() => new Set());
  const [viewing, setViewing] = useState<number | null>(null);
  // the strongest step's photo first and larger, the others in time order (photoOrder); none flagged: as recorded
  const { photos: shown, big } = photoOrder(photos.filter((p) => !refused.has(p.id)));
  if (shown.length === 0) return null;
  const tile = (p: AnnouncementPhoto, i: number) => {
    const caption = photoCaption(p);
    return (
      <figure key={p.id} className={`photo-tile${big && i === 0 && !lead ? " photo-tile-strongest" : ""}`}>
        <button type="button" className="photo-tile-open"
          aria-label={`View photo ${i + 1} of ${shown.length}${caption ? `, ${caption}` : ""}`}
          onClick={(e) => { e.stopPropagation(); setViewing(i); }}>
          <img src={announcementPhotoUrl(p.id)} alt="" onError={() => setRefused((was) => new Set(was).add(p.id))} />
        </button>
        {caption && <figcaption>{caption}</figcaption>}
      </figure>
    );
  };
  const tiles = shown.map(tile);
  return (
    <div className={`photo-row${lead ? " photo-row-lead" : ""}`}>
      {lead ? <>{tiles[0]}{tiles.length > 1 && <div className="photo-row-rest">{tiles.slice(1)}</div>}</> : tiles}
      {viewing !== null && (
        <PhotoLightbox photos={shown.map((p) => ({ src: announcementPhotoUrl(p.id), label: photoCaption(p) }))}
          index={viewing} onIndexChange={setViewing} onClose={() => setViewing(null)} />
      )}
    </div>
  );
}

/** A page VESTA attached (a report's, an investigation's), opened in the document viewer — ONE link for every place a
 *  VESTA message shows (the Inbox's report, the conversation's answer: architecture review 2026-10-29 #4), and every
 *  card's (RecordCard `pages`: a ticket's investigation too, architecture review 19 #3). The caller offers it only to a
 *  profile the add-on serves pages to. */
export function PageLink({ page, label = "Open the page" }: {
  page: string;
  /** What it opens, when more than "the page" is known (a ticket's "Investigation report"). */
  label?: ReactNode;
}) {
  return (
    <div className="fm-documents">
      <a className="fm-document-link" href={documentUrl(page)} target="_blank" rel="noopener noreferrer">
        <FileText size={15} aria-hidden="true" /> {label}
      </a>
    </div>
  );
}

/** A record's buttons, drawn — pure (a check draws it): the ones `buttons` lists (announcements.offeredButtons: what this
 *  profile is offered) until one is pressed, then the choice made with VESTA's own short answer (`answer`) or the
 *  add-on's word (announcements.pressedRow). */
export function ButtonRow({ buttons, onPress, presses, answer }: {
  buttons: readonly AnnouncementButton[]; onPress: (b: AnnouncementButton) => void; presses: PressState; answer?: string;
}) {
  if (buttons.length === 0) return null;
  // the buttons still offered, or the choice made (announcements.pressedRow: every row of buttons alike)
  const row = pressedRow(buttons, presses, answer);
  return (
    <span className="vesta-notice-actions">
      {row.buttons.map((b) => (
        <button key={b.command} type="button" className={`${CARD_BUTTON} vesta-notice-action`}
          disabled={presses[b.command] === "sending"} onClick={() => onPress(b)}>
          {b.label}
        </button>
      ))}
      {row.said && <span className="vesta-notice-said">{row.said}</span>}
    </span>
  );
}

/** ⚠️ THE ONE BUTTON ROW OF EVERY RECORD (owner, 2026-10-29: "implement button in the notification for every use case
 *  it's relevant … DRY, centralising all the configuration and layout"): a villa announcement's (the doorbell's Unlock),
 *  one of VESTA's messages (Approve / Refuse, Done, Need help, an offer) or a turn of VESTA's conversation (Continue) —
 *  in the notice, the full screen, the Inbox's card and the conversation alike. Who is offered which button is
 *  announcements.offeredButtons; a button that asks first asks in the tablet's one confirmation box (useConfirmDialog:
 *  an approval, owner 2026-10-28); a press goes through the page's one record (useAnnouncementPress) to its record's door
 *  (announcements.pressOf); VESTA's short answer comes back in this profile's conversation (ConversationContext). */
export function RecordButtons({ record }: { record: Pressable }) {
  const profile = useProfileOrNull();
  const { presses, press, numberOf } = useAnnouncementPress(record);
  const { answers } = useConversation();
  const { ask, dialog } = useConfirmDialog();
  const offered = offeredButtons(record.buttons, roleCan(profile?.role ?? null, "viewAgent"));
  // VESTA's answer to the last of this record's presses that has one
  const answer = offered.map((b) => numberOf(b.command)).reverse()
    .map((n) => (n !== undefined ? answers.get(n) : undefined)).find(Boolean);
  return <><ButtonRow buttons={offered} onPress={(b) => pressOrAsk(b, ask, press)} presses={presses} answer={answer} />
    {dialog}</>;
}

/** A tap on `b`: sent at once, or — a button that asks first (an approval: its kind's `confirm`) — asked in the one
 *  confirmation box, sent only once confirmed. Pure: tests/oracles/conversation_model.mjs. */
export function pressOrAsk(b: AnnouncementButton, ask: (q: Question) => void, press: (command: string) => void): void {
  if (b.confirm) ask({ title: b.label, message: b.confirm, confirmLabel: b.label, run: () => press(b.command) });
  else press(b.command);
}

/** ⚠️ AN ANNOUNCEMENT'S STATUS, ONE BLOCK (UI scan, 2026-11-10): "Status:", its story's lines, then where it stands, as
 *  Telegram writes it. The full screen joined them into one unlabelled paragraph of its own, and a bottom line with no
 *  story had no label on the card either. Nothing when it has neither. */
export function StatusLines({ announcement }: { announcement: Pick<Announcement, "story" | "status"> }) {
  const story = announcement.story ?? [];
  if (story.length === 0 && !announcement.status) return null;
  return (
    <div className="announcement-full-status">
      <span className="announcement-status-label">Status:</span>
      {story.map((line, i) => <span key={i} className="announcement-story-line">{line}</span>)}
      {announcement.status && <span>{announcement.status}</span>}
    </div>
  );
}

/** Everything an announcement says, below its title: its photos (PhotoRow), all its words, its bottom line — then `buttons`
 *  (RecordButtons, where the screen shows them under the words). Pure: a check draws it. */
export function AnnouncementContent({ announcement, buttons }: { announcement: Announcement; buttons?: ReactNode }) {
  return (
    <>
      {/* who it is for, as Telegram's "To:" line says it */}
      {announcement.to && <p className="announcement-full-to">To: {announcement.to}</p>}
      <PhotoRow photos={announcement.photos} />
      {announcement.text && <p className="announcement-full-text">{announcement.text}</p>}
      {/* VESTA's card: its Status story, then where it stands, as on Telegram */}
      <StatusLines announcement={announcement} />
      {buttons}
    </>
  );
}
