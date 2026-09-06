// src/utils/csv.ts
//
// HOW A TABLE BECOMES A FILE — RFC 4180, once.
//
// ⚠️ THERE WERE TWO HAND-ROLLED WRITERS AND ONE OF THEM EXPLAINED WHY THE
// OTHER'S LINE ENDING WAS WRONG. `ConcernLifecycle` states the rule and the
// harm — "⚠️ CSV, AND `\r\n` ENDINGS, BECAUSE THE DESTINATION IS A SPREADSHEET.
// RFC 4180 is what Excel and Numbers expect; a bare \n opens as one long row in
// older Excel on Windows, which is precisely the reader who asked for a file
// rather than a screen" — and `UsagePanel`, which predates it, shipped
// `lines.join("\n")`. Both carried an identical `cell` quoter and explained it
// separately.
//
// This is `download.ts`'s own story one turn later: that file fixed HOW A FILE
// LEAVES after five copies of the save idiom had drifted; nothing owned how a
// table becomes one.
//
// ⚠️ IMPORTS NOTHING AT RUNTIME, so the quoting rules a comment used to hold
// are executable — `tests/consistency/villa_rules.ts` pins them.

/** One field, quoted only when it must be.
 *
 *  ⚠️ THE THREE CHARACTERS THAT FORCE QUOTES are the comma (or the field shifts
 *  a column), the double quote (which must also be doubled), and a newline (or
 *  the record splits in two). Anything else is left alone, because a file full
 *  of unnecessary quotes is harder for a person to read in a text editor —
 *  which is the other thing an exported CSV is for. */
export function cell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  if (!/[",\r\n]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

/**
 * A table as an RFC 4180 document.
 *
 * ⚠️ `\r\n`, INCLUDING AFTER THE LAST RECORD. The trailing terminator is what
 * the spec permits and what spreadsheets expect; the line ending is what stops
 * older Excel on Windows opening the whole export as one row.
 */
export function toCsv(columns: readonly string[],
                      rows: readonly (readonly unknown[])[]): string {
  const lines = [columns.map(cell).join(",")];
  for (const row of rows) lines.push(row.map(cell).join(","));
  return lines.join("\r\n") + "\r\n";
}
