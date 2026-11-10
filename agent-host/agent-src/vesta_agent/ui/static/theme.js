// The page's theme, all of it: "light" or "dark" chosen in the header (kept in this browser), or "auto", the device's,
// followed when the device changes. The one in force is written as data-theme on <html> before anything is drawn, so
// the page never flashes the other one and app.css holds each palette once.
(function () {
  var KEY = "vesta-agent-theme", mode = "auto";
  var device = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
  try { mode = localStorage.getItem(KEY) || "auto"; } catch (e) { /* private window: auto */ }
  if (mode !== "light" && mode !== "dark") mode = "auto";
  function apply() {
    document.documentElement.setAttribute("data-theme", mode !== "auto" ? mode : device && device.matches ? "dark" : "light");
    document.querySelectorAll("[data-theme-set]").forEach(function (b) {     // the header's switch, once it is there
      b.classList.toggle("on", b.dataset.themeSet === mode);
      b.setAttribute("aria-checked", String(b.dataset.themeSet === mode));
    });
  }
  apply();
  if (device && device.addEventListener) device.addEventListener("change", apply);
  else if (device && device.addListener) device.addListener(apply);         // an older phone's web view
  document.addEventListener("DOMContentLoaded", function () {
    document.querySelectorAll("[data-theme-set]").forEach(function (b) {
      b.addEventListener("click", function () {
        mode = b.dataset.themeSet;
        try { localStorage.setItem(KEY, mode); } catch (e) { /* kept for this visit only */ }
        apply();
      });
    });
    apply();
  });
})();
