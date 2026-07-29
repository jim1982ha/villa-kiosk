// src/components/fm/ReportPreview.tsx
// Renders the Markdown fmReport.ts produces as formatted HTML, instead of the
// raw text a <pre> block showed before — the report reads as a document, not
// a technical dump, while the underlying string (still plain Markdown, used
// unchanged for the .md download) is exactly what buildMonthlyReport wrote.
//
// Purpose-built for the small, FIXED subset buildMonthlyReport actually
// emits — h1/h2/h3, **bold**, pipe tables, "- " bullet lists, a bare "---"
// rule, and a handful of whole-line "_..._" notes — rather than a general
// Markdown parser: pulling in a full Markdown library for one generator this
// app already controls end to end would be the wrong tool for a grammar this
// small and this fixed. Table CELL content is already pipe-escaped at
// generation time (buildMonthlyReport replaces literal "|" in user text
// before writing a row), so splitting on "|" here is safe.
//
// Renders as React elements throughout, never dangerouslySetInnerHTML — user
// text (a ticket title, a cost label) flows straight through React's own
// escaping, the same protection every other screen in the app already
// relies on, with nothing extra to get wrong here.

import type { ReactNode } from "react";

type Block =
  | { type: "h1" | "h2" | "h3"; text: string }
  | { type: "hr" }
  | { type: "ul"; items: string[] }
  | { type: "table"; header: string[]; rows: string[][] }
  | { type: "note"; text: string }
  | { type: "p"; text: string };

function splitRow(line: string): string[] {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
}

function parseBlocks(markdown: string): Block[] {
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

/** `**bold**` -> <strong>; everything else passes through as plain React
 *  children (and is therefore escaped, never interpreted as markup). */
function inline(text: string, key: string): ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/g).filter((p) => p !== "");
  return parts.map((part, idx) =>
    part.startsWith("**") && part.endsWith("**")
      ? <strong key={`${key}-${idx}`}>{part.slice(2, -2)}</strong>
      : part,
  );
}

export default function ReportPreview({ markdown }: { markdown: string }) {
  const blocks = parseBlocks(markdown);
  return (
    <div className="fm-report-doc">
      {blocks.map((b, i) => {
        const key = `b${i}`;
        switch (b.type) {
          case "h1":
            return <h1 key={key} className="fm-report-h1">{inline(b.text, key)}</h1>;
          case "h2":
            return <h2 key={key} className="fm-report-h2">{inline(b.text, key)}</h2>;
          case "h3":
            return <h3 key={key} className="fm-report-h3">{inline(b.text, key)}</h3>;
          case "hr":
            return <hr key={key} className="fm-report-hr" />;
          case "note":
            return (
              <p key={key} className="muted body-text fm-report-note">
                <em>{inline(b.text, key)}</em>
              </p>
            );
          case "p":
            return <p key={key} className="fm-report-p">{inline(b.text, key)}</p>;
          case "ul":
            return (
              <ul key={key} className="fm-report-ul">
                {b.items.map((it, j) => <li key={`${key}-${j}`}>{inline(it, `${key}-${j}`)}</li>)}
              </ul>
            );
          case "table":
            return (
              <div key={key} className="fm-report-table-wrap">
                <table className="fm-report-table">
                  <thead>
                    <tr>
                      {b.header.map((h, j) => <th key={`${key}-h${j}`}>{inline(h, `${key}-h${j}`)}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {b.rows.map((r, j) => (
                      <tr key={`${key}-r${j}`}>
                        {r.map((c, k) => <td key={`${key}-r${j}-${k}`}>{inline(c, `${key}-r${j}-${k}`)}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
        }
      })}
    </div>
  );
}
