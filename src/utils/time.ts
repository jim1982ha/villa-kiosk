// src/utils/time.ts

/** Human runtime since an ISO timestamp, e.g. "2h 14m". */
export function formatRuntime(sinceIso: string): string {
  const ms = Date.now() - new Date(sinceIso).getTime();
  if (ms < 0 || !Number.isFinite(ms)) return "—";
  const mins = Math.floor(ms / 60000);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m}m`;
  return `${h}h ${m}m`;
}
