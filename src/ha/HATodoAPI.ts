// src/ha/HATodoAPI.ts
//
// The villa's own to-do list, read and ticked from the kiosk.
//
// ⚠️ ITEMS ARE NOT IN THE STATE MACHINE, WHICH IS THE WHOLE REASON THIS EXISTS.
// A `todo.*` entity's STATE is a COUNT — "3" — and its items live behind a
// websocket command. So `useHA().entities` can tell you how many jobs are
// outstanding and nothing whatever about what they are, which is why an
// agent-raised job was visible only in Home Assistant's own To-do panel and
// invisible everywhere in this app. The Facility manager, whose work those jobs
// ARE, had no view of them at all.
//
// ⚠️ ONE READER AND ONE WRITER, because two surfaces now show the same list
// (the Facility workspace and the agent's Act & Tell tab) and a second copy of
// either would be a second answer to "is this job done".
//
// ⚠️ IT DEGRADES TO AN EMPTY LIST, NEVER TO AN ERROR STATE THE CALLER HAS TO
// HANDLE. A villa with no to-do list configured, an unavailable entity, or a
// Home Assistant mid-restart are all "nothing to show" as far as a reporting
// surface is concerned — and a screen that renders an exception where a job
// list should be is worse than one that says the list is empty. The distinction
// that MATTERS (configured vs not) is made by the caller from the entity id it
// was given, which it already has.

import type { HAWebSocket } from "./HAWebSocket";

/** One row of a Home Assistant to-do list. */
export interface TodoItem {
  uid: string;
  summary: string;
  /** HA's own vocabulary: `needs_action` | `completed`. */
  status: string;
  description?: string;
  due?: string;
}

/** Every item on one list, oldest first as HA returns them. Never throws. */
export async function fetchTodoItems(
  ws: HAWebSocket, entityId: string,
): Promise<TodoItem[]> {
  const id = String(entityId || "").trim();
  if (!id) return [];
  try {
    const reply = await ws.sendMessage<{ items?: unknown }>(
      "todo/item/list", { entity_id: id });
    const rows = Array.isArray(reply?.items) ? reply.items : [];
    return rows.filter((r): r is TodoItem =>
      !!r && typeof r === "object"
      && typeof (r as TodoItem).uid === "string"
      && typeof (r as TodoItem).summary === "string");
  } catch {
    // See the header: a reporting surface wants "nothing to show", not a throw.
    return [];
  }
}

/** Tick one item off. Returns whether Home Assistant accepted it.
 *
 *  ⚠️ `todo.update_item` TAKES THE SUMMARY AS THE ITEM KEY, not the uid — the
 *  service's own contract, and the reason every job this app raises carries a
 *  reference in brackets at the START of its summary. The Telegram Done button
 *  matches on exactly the same string, so both routes tick the same row rather
 *  than two mechanisms agreeing by luck. */
export async function completeTodoItem(
  ws: HAWebSocket, entityId: string, summary: string,
): Promise<boolean> {
  if (!entityId || !summary) return false;
  try {
    await ws.sendMessage("call_service", {
      domain: "todo", service: "update_item",
      target: { entity_id: entityId },
      service_data: { item: summary, status: "completed" },
    });
    return true;
  } catch {
    return false;
  }
}

/** The concern reference a job carries, or "" — `[c12] Pump…` → `c12`.
 *
 *  ⚠️ THE BRACKET IS A CONTRACT WITH THREE OTHER PLACES, and this is the one
 *  parser. `agent/task.py` writes it, the Telegram Done button matches it, and
 *  the concern card is joined to its job by it. A second regex anywhere is a
 *  fourth place for the format to drift. */
export function referenceOf(summary: string): string {
  const m = /^\s*\[([^\]]+)\]/.exec(String(summary || ""));
  return m ? m[1].trim() : "";
}
