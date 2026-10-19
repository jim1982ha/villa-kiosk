// src/components/fm/FaultForm.tsx
// THE form for a fault: raising one (the Overview's "Raise a fault", a device panel's wrench) and editing one (a
// ticket in the Tickets tab). ONE form for both: a fault raised in a hurry from a phone — often a device and four
// words — is exactly the record someone later corrects or adds photos to, and a second, subtly different edit form is
// how the two drift apart. Lived inside the Faults tab until the Overview took over raising (owner, 2026-10-14).
//
// DeviceSearchPicker reaches every device of the villa, with free text for one that is not in its list (a spare part,
// something not wired into Home Assistant). The "devices offline" shortlist it once carried is gone: those devices
// are cards on the same Overview list, just above.

import { useEffect, useState } from "react";
import { useConfig } from "@/config/ConfigContext";
import { useEntityLabel } from "@/hooks/useEntityLabel";
import { useFmData } from "@/fm/FmDataContext";
import type { FmTicket } from "@/fm/fmTypes";
import { stageOf } from "@/fm/fmEngine";
import EvidenceRow from "./EvidenceRow";
import NotesField from "./NotesField";
import DeviceSearchPicker, { type DeviceOption } from "./DeviceSearchPicker";
import { useDeviceChoice } from "./useDeviceChoice";
import FormActions from "./FormActions";
import { deviceRoom } from "@/config/devicePlace";

export default function FaultForm({ editing, presetEntity, deviceOptions, onDone }: {
  /** The record being edited; absent when raising a new fault. */
  editing?: FmTicket;
  /** Raise a fault already pointed at this device (a device panel's wrench). The title stays EMPTY on purpose:
   *  someone reporting by hand usually describes what Home Assistant cannot see (a dripping tap), and a
   *  pre-written guess tends to be saved as it is. */
  presetEntity?: string;
  /** The villa's real devices, built once by the caller (FacilitySections / the Overview) — a form deriving its own
   *  list is how a picker came to offer entries no other screen showed. */
  deviceOptions: DeviceOption[];
  onDone: () => void;
}) {
  const { addTicket, updateTicket } = useFmData();
  const { resolvedRooms } = useConfig();
  const label = useEntityLabel();
  const device = useDeviceChoice();
  const { deviceText, entityId } = device;
  const [title, setTitle] = useState(editing?.title ?? "");
  const [note, setNote] = useState(editing?.note ?? "");
  const [photoIds, setPhotoIds] = useState<string[]>(editing?.photoIds ?? []);
  /** Why the last save was refused — the form keeps what was typed. */
  const [formError, setFormError] = useState<string | null>(null);

  // The device, once, when the form opens: the record's, or the one it was raised from.
  useEffect(() => {
    const id = editing?.entityId ?? presetEntity;
    if (id || editing?.deviceLabel) device.selectDevice(id ?? "", editing?.deviceLabel ?? (id ? label(id) : ""));
    // label() reads live config/entities; re-running on those would reset the form mid-edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing?.id, presetEntity]);

  // A person OPENS A TICKET (owner, 2026-10-14): what they open starts in progress, in the Tickets tab.
  const heading = !editing ? "Open a ticket" : stageOf(editing) === "fault" ? "Edit fault" : "Edit ticket";
  return (
    <div className="fm-form">
      <h3>{heading}</h3>
      <div className="fm-field">
        <span>Device (search, or type one not listed)</span>
        <DeviceSearchPicker
          {...device.pickerProps}
          onSelect={(opt) => device.selectDevice(opt.entityId, opt.label)}
          options={deviceOptions}
        />
      </div>
      <label className="fm-field">
        <span>Summary</span>
        {/* One line: the headline someone scans a list for; what is actually wrong belongs below. */}
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Pool pump not starting" />
      </label>
      <NotesField
        label="Details (optional)"
        value={note}
        onChange={setNote}
        placeholder="What exactly happens, when it started, anything already tried…"
        rows={3}
      />
      <div className="fm-field">
        <span>Photo evidence</span>
        <EvidenceRow photoIds={photoIds} onChange={setPhotoIds} />
      </div>
      <FormActions
        error={formError} onCancel={onDone} disabled={!title.trim()}
        saveLabel={editing ? "Save changes" : "Open Ticket"}
        onSave={async () => {
          const fields = {
            title: title.trim(),
            entityId: entityId || undefined,
            deviceLabel: deviceText.trim() || undefined,
            room: entityId ? deviceRoom(resolvedRooms, entityId) : undefined,
            note: note.trim() || undefined,
            photoIds,
          };
          // Same fields either way — updateTicket leaves status, openedAt and resolvedAt alone, so correcting a
          // description never rewrites the record's history.
          const { done, note: why } = editing ? await updateTicket(editing.id, fields) : await addTicket(fields, { asTicket: true });
          // Closed only when saved or queued: a refused save used to throw away what was typed (2.496.252).
          if (done) onDone(); else setFormError(why);
        }}
      />
    </div>
  );
}
