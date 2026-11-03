// The Messages settings (ticket 16 of "One inbox", owner 2026-10-28; owner 2026-11-03: each full-screen announcement
// its own seconds, the villa's message settings moved from Advanced Settings into Settings › Messages, one section
// "Full-screen announcements"). The villa's list (`fullScreen`, every tablet, empty by default) and this tablet's
// switch ("Full screen on this tablet") are read, migrated, drafted and drawn here, by value and through the
// compiler's tree.
import { register } from "node:module";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";
import { elements, guardsOf, parseTsx, propText } from "../consistency/jsx.mjs";
const dc = await import("@/config/deviceConfig");
const { DEFAULT_CONFIG, FULL_SCREEN_S_DEFAULT, normaliseConfig } = await import("@/config/AppConfig");
const { ADVANCED_SETTINGS_KEYS } = await import("@/config/configSlice");
const J = JSON.stringify;

console.log("  whose each setting is:");
ck("\"Full-screen announcements\" is the villa's: shared with every tablet; drafted by Settings, no longer Advanced Settings",
   dc.SHARED_CONFIG_KEYS.includes("fullScreen") && !ADVANCED_SETTINGS_KEYS.includes("fullScreen"));
ck("  ...the retired keys are gone from both", ["fullScreenFor", "ringShownForS"].every((k) => !dc.SHARED_CONFIG_KEYS.includes(k)
   && !ADVANCED_SETTINGS_KEYS.includes(k) && !(k in DEFAULT_CONFIG)));
ck("  ...\"Full screen on this tablet\" this tablet's alone", !dc.SHARED_CONFIG_KEYS.includes("ringsFullScreen"));
ck("an empty default: nothing takes the screen until the owner picks; a tablet allows it; a new pick starts at 60s",
   J(DEFAULT_CONFIG.fullScreen) === "[]" && DEFAULT_CONFIG.ringsFullScreen === true && FULL_SCREEN_S_DEFAULT === 60
   && J(dc.baselineFromServer({}).fullScreen) === "[]");

console.log("\n  what was stored before 2.496.670 (its titles and one time for all), nothing lost:");
{
  // ONE table of migrations (config/migrations.ts), run by normaliseConfig on every config entering memory; the villa's
  // copy is the add-on server's to migrate (supervisor-proxy.py _device_config_today), through the same examples
  const { MIGRATIONS, RETIRED_KEYS, migrate } = await import("@/config/migrations");
  const { VILLA_MIGRATION_EXAMPLES: EXAMPLES, VILLA_RETIRED_KEYS } = await import("@/config/villaSettings");
  // the same document whatever its keys' order
  const canon = (v) => JSON.stringify(v, (_k, x) => (x && typeof x === "object" && !Array.isArray(x)
    ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : x));
  ck("each stored shape reads as villa-settings.json's examples say (the server drives the same ones)",
     EXAMPLES.length >= 5 && EXAMPLES.every((e) => canon(migrate(e.stored)) === canon(e.today)),
     EXAMPLES.filter((e) => canon(migrate(e.stored)) !== canon(e.today)).map((e) => [e._, migrate(e.stored)]));
  ck("  ...the examples cover an old time out of range (the default) and today's item out of range (left out)",
     EXAMPLES.some((e) => e.stored.ringShownForS === 100000 && e.today.fullScreen?.[0]?.seconds === FULL_SCREEN_S_DEFAULT)
     && EXAMPLES.some((e) => e.stored.fullScreen?.some?.((f) => f?.seconds === 100000)));
  ck("the retired keys are the table's, and the server drops the same ones from the villa's copy",
     J(RETIRED_KEYS) === J(MIGRATIONS.flatMap((m) => m.retires)) && J([...RETIRED_KEYS].sort()) === J([...VILLA_RETIRED_KEYS].sort()));
  const old = { fullScreenFor: ["🔔 Visitor at Gate A", "🔥 Overload", "🧪 Weekly test"], ringShownForS: 10 };
  const want = old.fullScreenFor.map((title) => ({ title, seconds: 10 }));
  // this tablet's own stored copy: loadConfig hands what was stored, with no defaults under it, to normaliseConfig
  const store = new Map([["villa-kiosk:config:v2", JSON.stringify({ ...old, theme: "dark" })]]);
  globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
  const { loadConfig } = await import("@/config/AppConfig");
  const loaded = loadConfig();
  ck("this tablet's own stored copy is read as each title with that time, the retired keys gone",
     J(loaded.fullScreen) === J(want) && loaded.theme === "dark" && RETIRED_KEYS.every((k) => !(k in loaded)), loaded.fullScreen);
  const inMemory = normaliseConfig({ ...DEFAULT_CONFIG, ...old });
  ck("  ...and once in memory no retired key is carried", !("fullScreenFor" in inMemory) && !("ringShownForS" in inMemory));
  const parsed = dc.parseSharedConfig(old);
  ck("the villa's copy is read in today's shape only: an old one (nothing serves it) leaves the list out, this tablet keeps its own",
     !("fullScreen" in parsed) && !("fullScreenFor" in parsed) && !("ringShownForS" in parsed), parsed);
  // the villa's copy as the server serves it and this tablet's own, both migrated: nothing to push until the owner changes it
  ck("  ...the villa's migrated copy and this tablet's read alike: nothing to push",
     dc.isSharedConfigDiffEmpty(dc.diffSharedConfig(dc.baselineFromServer(dc.parseSharedConfig(migrate(old))),
       dc.pickSharedConfig(loaded))));
  let sent = null;
  globalThis.window ??= { location: { pathname: "/", origin: "http://kiosk" } };
  globalThis.fetch = async (_url, init) => { sent = JSON.parse(init.body); return new Response("{}", { status: 200 }); };
  await dc.saveSharedConfig(dc.pickSharedConfig({ ...DEFAULT_CONFIG, fullScreen: want }), "1", { fromANewerVersion: 1 });
  ck("a save writes today's key (keys this version does not know are still carried)",
     !!sent && J(sent.config.fullScreen) === J(want) && sent.config.fromANewerVersion === 1, sent);
}

console.log("\n  each announcement's own seconds:");
{
  const parsed = dc.parseSharedConfig({ fullScreen: [{ title: "A", seconds: 0 }, { title: "B", seconds: 601 }, { title: "C", seconds: 1.5 },
    { title: "D", seconds: "60" }, { title: "", seconds: 30 }, { title: "E", seconds: 600 }, { title: "E", seconds: 5 }, 7, null, { title: "F", seconds: 1 }] });
  ck("a time that is not whole seconds from 1 to 600 is refused (its item left out), each title once",
     J(parsed.fullScreen) === J([{ title: "E", seconds: 600 }, { title: "F", seconds: 1 }]), parsed);
  const { secondsWrite } = await import("@/components/settings/MessagesSettings");
  const cfg = { ...DEFAULT_CONFIG, fullScreen: [{ title: "A", seconds: 10 }, { title: "B", seconds: 20 }] };
  ck("the field: a time it takes writes that announcement's seconds only, the others as they are",
     J(secondsWrite("B", "45")(cfg).fullScreen) === J([{ title: "A", seconds: 10 }, { title: "B", seconds: 45 }]));
  ck("  ...out of range, empty or not a number writes nothing (the field falls back)",
     ["0", "601", "", " ", "1.5", "abc", "-3"].every((t) => secondsWrite("A", t) === null));
  const base = dc.pickSharedConfig(cfg);
  const mine = dc.diffSharedConfig(base, { ...base, fullScreen: [{ title: "A", seconds: 99 }, { title: "B", seconds: 20 }] });
  const theirs = { ...base, fullScreen: [...base.fullScreen, { title: "C", seconds: 60 }] };
  ck("one tablet changing A's seconds while another adds C: both stand",
     J(dc.applySharedConfigDiff(theirs, mine).fullScreen) === J([{ title: "A", seconds: 99 }, { title: "B", seconds: 20 }, { title: "C", seconds: 60 }]));
}

console.log("\n  the rows, drawn:");
{
  const { h, draw } = await import("../consistency/screen.mjs");
  const { PendingFields } = await import("@/hooks/usePendingField");
  const { PendingEdits } = await import("@/config/pendingEdits");
  const { FullScreenAnnouncements } = await import("@/components/settings/MessagesSettings");
  const value = [{ title: "🔔 Visitor", seconds: 15 }, { title: "🔥 Overload", seconds: 300 }];
  const quiet = console.error; console.error = () => {}; // the tooltip's layout effect, said on every server render
  const html = draw(h(PendingFields, { pending: new PendingEdits(() => {}) }, h(FullScreenAnnouncements, { value, onChange: () => {} })));
  console.error = quiet;
  const fields = [...html.matchAll(/<input[^>]*aria-label="Seconds ([^"]+) fills the screen"[^>]*>/g)]
    .map((m) => [m[1], /value="(\d+)"/.exec(m[0])?.[1]]);
  ck("one seconds field per picked announcement, named for it, holding its own time",
     J(fields) === J([["🔔 Visitor", "15"], ["🔥 Overload", "300"]]), fields);
  ck("  ...each with its ✕ to take it off, and the picker to add one", (html.match(/aria-label="Take [^"]+ off full screen"/g) ?? []).length === 2
     && /placeholder="Add an announcement…"/.test(html));
  ck("  ...no \"Ring shown for\" anywhere", !/Ring shown for/i.test(html));
}

console.log("\n  where they are:");
{
  const adv = parseTsx("components/settings/ConfigEditorModal.tsx");
  const advText = adv.getText();
  ck("Advanced Settings has no Messages tab any more (owner, 2026-11-03: in Settings itself)",
     !/id: "messages"/.test(advText) && !/tab === "messages"/.test(advText)
     && elements(adv, "WhoGetsMessages").length === 0 && elements(adv, "FullScreenAnnouncements").length === 0);
  const set = parseTsx("components/settings/SettingsModal.tsx");
  // every guard above an element, through the elements between (guardsOf stops at the nearest one)
  const allGuards = (el) => { const out = []; for (let n = el; n; n = n.parent) out.push(...guardsOf(n)); return out; };
  const fs = elements(set, "FullScreenAnnouncements"), who = elements(set, "WhoGetsMessages");
  ck("Settings › Messages holds the villa's list and \"Who gets the messages\", each only where can(\"editConfig\")",
     fs.length === 1 && who.length === 1
     && [...fs, ...who].every((e) => guardsOf(e).includes('can("editConfig")') && allGuards(e).includes('tab === "messages"')),
     [...fs, ...who].map(allGuards));
  const sw = elements(set, "OnOffToggle").filter((e) => propText(e, "ariaLabel") === '"Full screen on this tablet"');
  ck("  ...this tablet's switch for every profile that opens Settings, an On | Off, first in the section",
     sw.length === 1 && !allGuards(sw[0]).includes('can("editConfig")') && allGuards(sw[0]).includes('tab === "messages"')
     && fs.length === 1 && sw[0].getStart() < fs[0].getStart()
     && /\(ringsFullScreen\) => slice\.set\(\{ ringsFullScreen \}/.test(propText(sw[0], "onChange")));
  const tips = elements(set, "TipTitle").map((e) => propText(e, "title"));
  const at = (t) => tips.indexOf(t);
  ck("  ...one section \"Full-screen announcements\", the language's after it, \"Who gets the messages\" last",
     at('"Full-screen announcements"') >= 0 && at('"Full-screen announcements"') < at('"VESTA\'s messages on this tablet, in"')
     && at('"VESTA\'s messages on this tablet, in"') < at("LISTS_TITLE"), tips);
  ck("  ...its list written through Settings' one draft, its seconds waiting in that draft's store",
     fs.length === 1 && /slice\.set\(\{ fullScreen \}/.test(propText(fs[0], "onChange"))
     && elements(set, "PendingFields").some((p) => propText(p, "pending") === "slice.pending"));
}

done("✅ the Messages settings: each full-screen announcement its own time, in Settings › Messages, the old shape read");
