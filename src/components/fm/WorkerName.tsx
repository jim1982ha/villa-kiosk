// src/components/fm/WorkerName.tsx
// "Done by" and "Who's handling it": the name typed, as the person writes it, every time.
//
// ⚠️ TYPED, NEVER OFFERED (owner, 2026-11-02: "this shouldn't be read from any cache. it shall be a value the user has
// to manually enter"): from 2026-10-30 the box offered every name any record held (fmEngine.knownWorkers), and the
// Open a ticket window showed "Fab & Jm", "KosyStay", "Kazia" before anything was typed. No list, and the browser's own
// memory of earlier entries is switched off too (autoComplete).

export default function WorkerName({ value, onChange, placeholder }: {
  /** The name typed ("" for none). */
  value: string;
  onChange: (name: string) => void;
  /** Said in the box while it is empty. */
  placeholder: string;
}) {
  return (
    <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
      autoComplete="off" autoCorrect="off" spellCheck={false} />
  );
}
