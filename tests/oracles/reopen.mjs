// Opening VESTA UI again (utils/reopen), decided through a fake browser: the view switch, the update notice, the 04:00
// reopen, the error screen and "Try once more" all go through it (architecture review, 2026-11-25: six places, each
// with its own idea of "safe"; the view switch alone took three fixes found by the owner).
import { ck, done } from "../consistency/check.mjs";
const { createReopen, withoutViewAsked, UNSENT_RETRY_MS } = await import("@/utils/reopen");

/** A page: whether a window is open, whether work is unsent, its address; what it did. */
function page({ href = "http://localhost:8123/app/", open = false, unsent = false } = {}) {
  const p = { href, open, unsent, did: [], closedWaiting: [], later: [] };
  p.reopen = createReopen({
    whenAllClosed: (fn) => { if (p.open) p.closedWaiting.push(fn); else fn(); },
    unsentWorkHeld: () => p.unsent,
    href: () => p.href,
    reload: () => p.did.push("reload"),
    replace: (url) => p.did.push(`replace ${url}`),
    later: (fn, ms) => p.later.push([fn, ms]),
  });
  p.close = () => { p.open = false; for (const fn of p.closedWaiting.splice(0)) fn(); };
  p.tick = () => { for (const [fn] of p.later.splice(0)) fn(); };
  return p;
}

console.log("  when:");
{
  const p = page();
  p.reopen();
  ck("nothing open, nothing unsent: at once, the same address reloaded", p.did.join() === "reload", p.did);
}
{
  const p = page({ open: true });
  p.reopen();
  ck("a window open (Settings, as its Save closes it): nothing yet", p.did.length === 0);
  p.close();
  ck("  ...once it has closed and history is back: reloaded (the close's step back cancelled it)", p.did.join() === "reload", p.did);
}
{
  const p = page({ unsent: true });
  p.reopen();
  ck("a fault reported offline, not yet sent: nothing, asked again later", p.did.length === 0 && p.later[0]?.[1] === UNSENT_RETRY_MS);
  p.tick();
  ck("  ...still unsent: still nothing", p.did.length === 0 && p.later.length === 1);
  p.unsent = false; p.tick();
  ck("  ...sent: reloaded", p.did.join() === "reload", p.did);
}

console.log("\n  how:");
{
  const p = page({ href: "http://localhost:8123/app/?view=3d&debug=1#top" });
  p.reopen();
  ck("an address asking for a view opens without it (it set the old view back)",
     p.did.join() === "replace http://localhost:8123/app/?debug=1#top", p.did);
}
{
  const p = page({ href: "http://localhost:8123/app/#" });
  p.reopen();
  ck("the same address with a # is reloaded, not replaced (a replace opened nothing)", p.did.join() === "reload", p.did);
}
ck("withoutViewAsked keeps the rest of the address", withoutViewAsked("http://localhost:8123/a/?x=1&view=pictures") === "http://localhost:8123/a/?x=1");

console.log("\n  once:");
{
  const p = page({ open: true });
  p.reopen(); p.reopen();
  p.close();
  ck("asked twice while it waits (a Save, then the update notice): one reopen", p.did.length === 1, p.did);
}

done("✅ every reopen waits for closed windows and unsent work, opens without ?view=, and happens once");
