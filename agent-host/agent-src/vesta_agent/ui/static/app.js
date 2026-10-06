// VESTA Agent UI. No framework, no build step, nothing fetched from the internet.
// Every text from the files is put in the page as text (never as HTML).
// The tabs are one module each (architecture review, 2026-10-06: one 1,324-line file); this one starts the page.
import { go, guard, page } from "./core.js";
import { costs } from "./costs.js";
import { overview } from "./overview.js";
import { rules } from "./rules.js";
import { skills } from "./skills.js";

page.views = { overview, rules, "rules-file": () => rules("file"), skills, costs };

// ---------------------------------------------------------------- theme (Light / Auto / Dark)
export function setTheme(mode) {
  if (mode === "light" || mode === "dark") document.documentElement.setAttribute("data-theme", mode);
  else document.documentElement.removeAttribute("data-theme");
  try { localStorage.setItem("vesta-agent-theme", mode); } catch (e) { /* kept for this visit only */ }
  document.querySelectorAll("[data-theme-set]").forEach((b) => {
    b.classList.toggle("on", b.dataset.themeSet === mode);
    b.setAttribute("aria-checked", String(b.dataset.themeSet === mode));
  });
}
document.querySelectorAll("[data-theme-set]").forEach((b) => b.addEventListener("click", () => setTheme(b.dataset.themeSet)));
setTheme(document.documentElement.getAttribute("data-theme") || "auto");

// ---------------------------------------------------------------- tabs
// one "Rules (file)" tab (owner, 2026-10-01): "Rules" opens the forms, "(file)" the file itself
document.querySelectorAll(".tabs button").forEach((b) => b.addEventListener("click", async (e) => {
  const tab = e.target.closest(".tab-file") ? "rules-file" : b.dataset.tab;
  if (tab === page.current || !(await guard())) return;
  go(tab);
}));

go(["overview", "rules", "rules-file", "skills", "costs"].includes(location.hash.slice(1)) ? location.hash.slice(1) : "overview");
