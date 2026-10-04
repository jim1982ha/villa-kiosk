// src/fm/docBlocks.ts
// THE READER OF THE FACILITY DOCUMENTS' MARKDOWN — the fixed grammar
// fmDocuments.ts writes (headings, pipe tables, "- " lists, "---", whole-line
// "_notes_", **bold**), as blocks for MarkdownPreview to draw. Pure:
// tests/oracles/doc_blocks.mjs round-trips every document through it.
//
// ⚠️ IT LIVED INSIDE MarkdownPreview.tsx (until 2.496.286), so the writer was
// tested (document_cells.mjs) and its reader was not: nothing checked that a
// table the recap writes is read back with its header's columns.

export type Block =
  | { type: "h1" | "h2" | "h3"; text: string }
  | { type: "hr" }
  | { type: "ul"; items: string[] }
  | { type: "table"; header: string[]; rows: string[][] }
  | { type: "note"; text: string }
  | { type: "p"; text: string };

function splitRow(line: string): string[] {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
}

export function parseBlocks(markdown: string): Block[] {
  const lines = markdown.split("\n");
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i].replace(/\s+$/, "");
    if (line.trim() === "") { i++; continue; }
    if (line.trim() === "---") { blocks.push({ type: "hr" }); i++; continue; }
    if (line.startsWith("### ")) { blocks.push({ type: "h3", text: line.slice(4) }); i++; continue; }
    if (line.startsWith("## ")) { blocks.push({ type: "h2", text: line.slice(3) }); i++; continue; }
    if (line.startsWith("# ")) { blocks.push({ type: "h1", text: line.slice(2) }); i++; continue; }
    if (line.startsWith("|")) {
      const header = splitRow(line);
      i++;
      // The "|---|---|" separator row — skip it, it carries no content.
      if (i < lines.length && /^\|[\s:|-]+\|?$/.test(lines[i].trim())) i++;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        rows.push(splitRow(lines[i]));
        i++;
      }
      blocks.push({ type: "table", header, rows });
      continue;
    }
    if (line.startsWith("- ")) {
      const items: string[] = [];
      while (i < lines.length && lines[i].replace(/\s+$/, "").startsWith("- ")) {
        items.push(lines[i].replace(/\s+$/, "").slice(2));
        i++;
      }
      blocks.push({ type: "ul", items });
      continue;
    }
    if (line.length > 1 && line.startsWith("_") && line.endsWith("_")) {
      blocks.push({ type: "note", text: line.slice(1, -1) });
      i++;
      continue;
    }
    blocks.push({ type: "p", text: line });
    i++;
  }
  return blocks;
}

/** A line's text as runs, `**bold**` marked — MarkdownPreview draws them. */
export function inlineRuns(text: string): { text: string; bold: boolean }[] {
  return text.split(/(\*\*[^*]+\*\*)/g).filter((p) => p !== "")
    .map((p) => (p.startsWith("**") && p.endsWith("**") ? { text: p.slice(2, -2), bold: true } : { text: p, bold: false }));
}
