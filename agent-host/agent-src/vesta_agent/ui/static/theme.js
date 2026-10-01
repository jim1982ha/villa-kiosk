// The page's theme, set before anything is drawn so it never flashes the other one: "light" or "dark"
// chosen in the header (kept in this browser), or "auto" — no attribute — following the device.
(function () {
  var t = null;
  try { t = localStorage.getItem("vesta-agent-theme"); } catch (e) { /* private window: auto */ }
  if (t === "light" || t === "dark") document.documentElement.setAttribute("data-theme", t);
})();
