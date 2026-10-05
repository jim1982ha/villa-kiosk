// src/components/fm/MarkdownPreview.tsx
// Renders the Markdown fmDocuments.ts produces as formatted HTML, instead of the
// raw text a <pre> block showed before — the recap reads as a document, not
// a technical dump, while the underlying string (still plain Markdown, used
// unchanged for the .md download) is exactly what buildMonthlyRecap wrote.
//
// Purpose-built for the small, FIXED subset buildMonthlyRecap actually
// emits — h1/h2/h3, **bold**, pipe tables, "- " bullet lists, a bare "---"
// rule, and a handful of whole-line "_..._" notes — rather than a general
// Markdown parser: pulling in a full Markdown library for one generator this
// app already controls end to end would be the wrong tool for a grammar this
// small and this fixed. Table CELL content is already pipe-escaped at
// generation time (buildMonthlyRecap replaces literal "|" in user text
// before writing a row), so splitting on "|" here is safe.
//
// Renders as React elements throughout, never dangerouslySetInnerHTML — user
// text (a ticket title, a cost label) flows straight through React's own
// escaping, the same protection every other screen in the app already
// relies on, with nothing extra to get wrong here.

import type { ReactNode } from "react";
import { parseBlocks, inlineRuns } from "@/fm/docBlocks";

/** `**bold**` -> <strong>; everything else passes through as plain React
 *  children (and is therefore escaped, never interpreted as markup). */
function inline(text: string, key: string): ReactNode {
  return inlineRuns(text).map((r, idx) => (r.bold ? <strong key={`${key}-${idx}`}>{r.text}</strong> : r.text));
}

export default function MarkdownPreview({ markdown }: { markdown: string }) {
  const blocks = parseBlocks(markdown);
  return (
    <div className="fm-doc-doc">
      {blocks.map((b, i) => {
        const key = `b${i}`;
        switch (b.type) {
          case "h1":
            return <h1 key={key} className="fm-doc-h1">{inline(b.text, key)}</h1>;
          case "h2":
            return <h2 key={key} className="fm-doc-h2">{inline(b.text, key)}</h2>;
          case "h3":
            return <h3 key={key} className="fm-doc-h3">{inline(b.text, key)}</h3>;
          case "hr":
            return <hr key={key} className="fm-doc-hr" />;
          case "note":
            return (
              <p key={key} className="muted body-text fm-doc-note">
                <em>{inline(b.text, key)}</em>
              </p>
            );
          case "p":
            return <p key={key} className="fm-doc-p">{inline(b.text, key)}</p>;
          case "ul":
            return (
              <ul key={key} className="fm-doc-ul">
                {b.items.map((it, j) => <li key={`${key}-${j}`}>{inline(it, `${key}-${j}`)}</li>)}
              </ul>
            );
          case "table":
            return (
              <div key={key} className="fm-doc-table-wrap">
                <table className="fm-doc-table">
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
