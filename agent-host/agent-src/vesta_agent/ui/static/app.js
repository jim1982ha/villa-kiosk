// VESTA Agent UI. No framework, no build step, nothing fetched from the internet.
// Every text from the files is put in the page as text (never as HTML).
// The tabs are one module each (architecture review, 2026-10-06: one 1,324-line file); this one starts the page.
import { go, guard, opened, page, segmented } from "./core.js";
import { costs } from "./costs.js";
import { knowledge } from "./knowledge.js";
import { limits } from "./limits.js";
import { overview } from "./overview.js";
import { rules } from "./rules.js";
import { skills } from "./skills.js";

// a tab opened with its place in the address (core.placed): the open skill and its file, Costs' period
page.views = { overview: () => overview(), rules: () => rules(), "rules-file": () => rules("file"), knowledge: () => knowledge(),
  skills: (name, ...file) => skills(name || null, file.length ? file.join("/") : undefined), costs, limits: () => limits() };

// the header's theme switch: the page's one "choose one of several" (core.segmented), the choice kept by theme.js
document.querySelector(".top").append(segmented([["light", "Light"], ["auto", "Auto", "Follow this device"], ["dark", "Dark"]],
  window.vestaTheme.mode(), window.vestaTheme.set, "Theme"));

// ---------------------------------------------------------------- tabs
// one "Rules (file)" tab (owner, 2026-10-01): "Rules" opens the forms, "(file)" the file itself
document.querySelectorAll(".tabs button").forEach((b) => b.addEventListener("click", async (e) => {
  const tab = e.target.closest(".tab-file") ? "rules-file" : b.dataset.tab;
  if (tab === page.current || !(await guard())) return;
  go(tab);
}));

go(...opened(location.hash));                            // where the address says, else Overview
