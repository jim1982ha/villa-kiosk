// src/fm/useMonthlyDocument.ts
// One generated document's state on a Cockpit tab — which month, what is on
// screen, whether that is saved — and its four actions: make it, save it,
// reopen a saved one, download it. The same for the recap, the spend
// statement and the readiness snapshot (monthlyDocument.ts): "Saved" stays
// while the document on screen is the one saved, and goes when another is
// made or the month changes.

import { useState } from "react";
import { useHA } from "@/ha/HAStateStore";
import { useConfig } from "@/config/ConfigContext";
import { resolveSiteTitle } from "@/config/AppConfig";
import { downloadFile } from "@/utils/download";
import { useFmData } from "./FmDataContext";
import type { FmSavedDocument } from "./fmTypes";
import { DOCUMENT_KINDS, defaultMonth, documentFileName, monthsOffered, type DocumentKind } from "./monthlyDocument";

export function useMonthlyDocument(kind: DocumentKind, build: (month: string, villaName: string) => string) {
  const { data, saveDocument } = useFmData();
  const { config } = useConfig();
  const { haConfig } = useHA();
  const villaName = resolveSiteTitle(config, haConfig?.location_name);
  const [month, setMonthState] = useState(() => defaultMonth(kind));
  // A snapshot, not a live useMemo: a document is a point-in-time record, and
  // its own "Generated:" time means the moment someone asked for it. Null
  // until made, and again when the month changes — June's must never keep
  // showing once July is chosen.
  const [markdown, setMarkdown] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const keep = async (md: string, m: string) => {
    // "Saved" only when it was; otherwise the store's banner says why.
    if (await saveDocument({ kind, month: m, markdown: md }) === "saved") setSaved(true);
  };

  return {
    ...DOCUMENT_KINDS[kind],
    kind, month, villaName,
    months: monthsOffered(kind, data),
    markdown, saved,
    setMonth: (m: string) => { setMonthState(m); setMarkdown(null); setSaved(false); },
    generate: () => { setMarkdown(build(month, villaName)); setSaved(false); },
    save: async () => { if (markdown) await keep(markdown, month); },
    /** Make it and save it in one go (the readiness snapshot: the check as it is now). */
    generateAndSave: async () => {
      const md = build(month, villaName);
      setMarkdown(md); setSaved(false);
      await keep(md, month);
    },
    reopen: (doc: FmSavedDocument) => { setMonthState(doc.month); setMarkdown(doc.markdown); setSaved(true); },
    close: () => { setMarkdown(null); setSaved(false); },
    download: () => { if (markdown) downloadFile(documentFileName(kind, villaName, month), markdown, "text/markdown"); },
  };
}

export type MonthlyDocument = ReturnType<typeof useMonthlyDocument>;
