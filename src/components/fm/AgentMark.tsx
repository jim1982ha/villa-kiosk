// src/components/fm/AgentMark.tsx
// "by VESTA Agent" on a Facility record the agent created or last changed
// (docs/agent-integration/PLAN.md A8). One component, used by every list that
// shows records, so the mark reads the same everywhere — the add-on stamps the
// record (FmProvenance), this only shows it. The Facility workspace is never
// open to a guest, so neither is this.

import type { FmProvenance } from "@/fm/fmTypes";
import { stampText } from "@/utils/dateText";

export default function AgentMark({ record }: { record: FmProvenance }) {
  if (record.source !== "vesta_agent") return null;
  return (
    <span className="fm-clause agent" title={record.updatedAt
      ? `Created or last changed by the VESTA Agent, ${stampText(record.updatedAt)}`
      : "Created or last changed by the VESTA Agent"}>
      by VESTA Agent
    </span>
  );
}
