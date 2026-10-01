// Loaded before app.js, as a plain script, so it also sees app.js failing to load or parse.
// A page error is shown on the page and written to the app's log (api/client-error): the page
// runs in a Home Assistant frame where its console is out of reach, so the log is where it is read.
(function () {
  var sent = 0;
  function report(msg) {
    try {
      var el = document.getElementById("pageerror");
      if (el) { el.hidden = false; el.textContent = "The page met an error: " + msg + " (written to the app's log)."; }
      if (sent++ < 5) {
        fetch("api/client-error", { method: "POST", headers: { "Content-Type": "application/json", "X-Vesta-UI": "1" },
          body: JSON.stringify({ message: String(msg).slice(0, 300), agent: navigator.userAgent.slice(0, 120) }) });
      }
    } catch (e) { /* nothing more can be done */ }
  }
  window.addEventListener("error", function (e) {
    report((e.message || "error") + (e.filename ? " at " + e.filename.split("/").pop() + ":" + e.lineno : ""));
  }, true);
  window.addEventListener("unhandledrejection", function (e) {
    var r = e.reason || {};
    report("unhandled: " + (r.message || (r.problems || []).join("; ") || String(r)));
  });
})();
