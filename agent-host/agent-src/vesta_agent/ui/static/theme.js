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
  }
  apply();
  if (device && device.addEventListener) device.addEventListener("change", apply);
  else if (device && device.addListener) device.addListener(apply);         // an older phone's web view
  // the header's switch is drawn by app.js with the page's own builder (core.segmented): the choice it shows, and
  // what a press does
  window.vestaTheme = {
    mode: function () { return mode; },
    set: function (chosen) {
      mode = chosen;
      try { localStorage.setItem(KEY, mode); } catch (e) { /* kept for this visit only */ }
      apply();
    },
  };
})();
