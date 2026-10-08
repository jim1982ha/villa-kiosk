// VESTA Agent page — a skill's Markdown read as blocks (owner, 2026-10-08: "show the formatted md file instead of the
// raw version"). Nothing fetched (the villa may have no internet) and no HTML string anywhere: parse() returns plain
// data, and the page builds it with core.h, so a file can never put markup or a script in the page. What a SKILL.md
// uses: front matter, headings, paragraphs, lists (nested by indent), code spans and fenced code, tables, bold,
// italic, links, quotes, rules. An HTML comment is left out, as a reader of the Markdown would not see it.
//
// A block: {t: "meta", rows: [[key, value]]} · {t: "h", level, inl} · {t: "p", inl} · {t: "list", items: [{depth,
// ordered, inl}]} · {t: "code", lang, text} · {t: "table", head: [inl], rows: [[inl]]} · {t: "quote", inl} · {t: "hr"}.
// An inline (inl) is a list of {t: "text", v} · {t: "code", v} · {t: "b", c: inl} · {t: "i", c: inl} · {t: "a", href, c: inl}.

const INLINE = /(`+)([\s\S]*?[^`])\1(?!`)|\*\*([\s\S]+?)\*\*|__([\s\S]+?)__|\*(?!\s)([^*]+?)\*|(?<![\w])_(?!\s)([^_]+?)_(?![\w])|\[([^\]]+)\]\(([^)\s]+)\)/g;

export function inline(s) {
  const out = [];
  let last = 0;
  for (const m of s.matchAll(INLINE)) {
    if (m.index > last) out.push({ t: "text", v: s.slice(last, m.index) });
    if (m[1]) out.push({ t: "code", v: m[2].replace(/^ (.*) $/, "$1") });
    else if (m[3] !== undefined || m[4] !== undefined) out.push({ t: "b", c: inline(m[3] ?? m[4]) });
    else if (m[5] !== undefined || m[6] !== undefined) out.push({ t: "i", c: inline(m[5] ?? m[6]) });
    else out.push({ t: "a", href: m[8], c: inline(m[7]) });
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push({ t: "text", v: s.slice(last) });
  return out;
}

const cells = (line) => line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => inline(c.trim()));
const TABLE_RULE = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;
const ITEM = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;

export function parse(text) {
  // an HTML comment is not part of what is read (several lines included)
  const lines = String(text || "").replace(/<!--[\s\S]*?-->/g, "").replace(/\r\n?/g, "\n").split("\n");
  const blocks = [];
  let i = 0;
  if (lines[0] === "---") {                                  // front matter: the skill's name and description
    const end = lines.indexOf("---", 1);
    if (end > 0) {
      const rows = lines.slice(1, end).filter((l) => l.includes(":"))
        .map((l) => [l.slice(0, l.indexOf(":")).trim(), l.slice(l.indexOf(":") + 1).trim()]);
      if (rows.length) blocks.push({ t: "meta", rows });
      i = end + 1;
    }
  }
  let para = [];
  const flush = () => { if (para.length) blocks.push({ t: "p", inl: inline(para.join(" ")) }); para = []; };
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { flush(); i++; continue; }
    const fence = line.match(/^\s*(```+|~~~+)\s*(\S*)/);
    if (fence) {
      flush();
      const close = lines.findIndex((l, k) => k > i && l.trim().startsWith(fence[1]));
      const end = close < 0 ? lines.length : close;
      blocks.push({ t: "code", lang: fence[2] || "", text: lines.slice(i + 1, end).join("\n") });
      i = end + 1; continue;
    }
    const head = line.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/);
    if (head) { flush(); blocks.push({ t: "h", level: head[1].length, inl: inline(head[2]) }); i++; continue; }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { flush(); blocks.push({ t: "hr" }); i++; continue; }
    if (line.trim().startsWith("|") && TABLE_RULE.test(lines[i + 1] || "")) {
      flush();
      const head = cells(line), rows = [];
      i += 2;
      while (i < lines.length && lines[i].trim().startsWith("|")) rows.push(cells(lines[i++]));
      blocks.push({ t: "table", head, rows });
      continue;
    }
    if (ITEM.test(line)) {
      flush();
      const items = [];
      while (i < lines.length && lines[i].trim()) {
        const m = lines[i].match(ITEM);
        if (m) items.push({ depth: Math.floor(m[1].replace(/\t/g, "  ").length / 2), ordered: /\d/.test(m[2]), text: m[3] });
        else if (/^\s+\S/.test(lines[i]) && items.length) items[items.length - 1].text += " " + lines[i].trim();   // its next line
        else break;
        i++;
      }
      blocks.push({ t: "list", items: items.map(({ text, ...it }) => ({ ...it, inl: inline(text) })) });
      continue;
    }
    if (/^\s*>/.test(line)) {
      flush();
      const q = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) q.push(lines[i++].replace(/^\s*>\s?/, ""));
      blocks.push({ t: "quote", inl: inline(q.join(" ")) });
      continue;
    }
    para.push(line.trim()); i++;
  }
  flush();
  return blocks;
}
