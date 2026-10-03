// Uploading the villa's model as ONE operation (src/utils/modelUpload.ts,
// 2.496.254): everything is checked before anything is written, a GLB always
// goes up with room data, and a half-finished upload says so. Until then the
// hook wrote a picked .json for every device and only then parsed it, and a
// GLB whose room data then failed stood silently with the old rooms.
// The embedded-copy reader (glbRoomDataExtractor) is driven with real GLB bytes.
import { register } from "node:module";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";
const { planModelUpload, runModelUpload, uploadReport } = await import("@/utils/modelUpload");
const { EMPTY_ROOM_DATA } = await import("@/config/roomData");

const sq = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }];
const ROOMS = JSON.stringify({ schema: 1, rooms: [{ name: "Room A", points: sq, floor: 1 }], entities: [] });
/** A glTF-Binary file: 12-byte header, then one JSON chunk (4-byte aligned). */
const glbBytes = (gltf) => {
  let json = new TextEncoder().encode(JSON.stringify(gltf));
  const pad = (4 - (json.length % 4)) % 4;
  json = new Uint8Array([...json, ...Array(pad).fill(0x20)]);
  const out = new Uint8Array(20 + json.length), dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true); dv.setUint32(4, 2, true); dv.setUint32(8, out.length, true);
  dv.setUint32(12, json.length, true); dv.setUint32(16, 0x4e4f534a, true);
  out.set(json, 20);
  return out;
};
const glb = (extras) => new File([glbBytes({ asset: { version: "2.0" }, nodes: [{ name: "carrier", ...(extras ? { extras } : {}) }] })], "Villa v7.glb");

console.log("  what is checked before anything is written:");
{
  const p = await planModelUpload([glb({ vk_rooms_json: ROOMS })]);
  ck("a GLB with room data embedded by the pipeline goes up WITH it, the model first",
     p.ok && p.steps.map((s) => `${s.kind}:${s.origin}`).join() === "glb:model,rooms:embedded"
     && p.steps[1].file.name === "Villa v7.rooms.json" && p.rooms.rooms[0].name === "Room A", p);
  const r = await planModelUpload([glb()]);
  ck("a GLB without room data goes up with the RESET, so devices drop the old rooms",
     r.ok && r.steps[1].origin === "reset" && (await r.steps[1].file.text()) === EMPTY_ROOM_DATA && r.rooms.rooms.length === 0, r);
  const g = await planModelUpload([glb({ vk_rooms_json: "{broken" })]);
  ck("  ...and so does one whose embedded copy is unreadable", g.ok && g.steps[1].origin === "reset");
  const both = await planModelUpload([new File([ROOMS], "plan.rooms.json"), glb({ vk_rooms_json: JSON.stringify({ rooms: [] }) })]);
  ck("a .json picked beside the GLB wins over the embedded copy", both.ok && both.steps[1].origin === "picked" && both.steps[1].file.name === "plan.rooms.json" && both.rooms.rooms.length === 1);
  const wrong = await planModelUpload([glb(), new File(['{"foo":1}'], "x.json")]);
  ck("A WRONG .json STOPS THE WHOLE UPLOAD before a byte is written — the GLB too",
     !wrong.ok && /x\.json: .*Nothing was uploaded/.test(wrong.message), wrong);
  const alone = await planModelUpload([new File([ROOMS], "plan.rooms.json")]);
  ck("a lone .json is one step", alone.ok && alone.steps.length === 1 && alone.steps[0].kind === "rooms");
  const none = await planModelUpload([new File(["x"], "notes.txt")]);
  ck("neither a .glb nor a .json: refused", !none.ok && /\.glb and\/or a \.rooms\.json/.test(none.message));
}

console.log("\n  writing, and what the person is told:");
{
  const plan = await planModelUpload([glb({ vk_rooms_json: ROOMS })]);
  const order = [];
  const put = (failKind) => async (s) => { order.push(s.kind); if (s.kind === failKind) throw new Error("HTTP 413"); return { path: s.kind === "glb" ? "villa.glb" : "villa.rooms.json", size: s.kind === "glb" ? 12_300_000 : 900 }; };
  const all = await runModelUpload(plan.steps, put(null));
  const rAll = uploadReport(all);
  ck("both written, the GLB first: ONE message naming the model, then a reload",
     order.join() === "glb,rooms" && rAll.ok && rAll.reload && rAll.text === "Uploaded 12.3 MB → villa.glb with its room data. Reloading…", rAll);
  order.length = 0;
  const half = await runModelUpload(plan.steps, put("rooms"));
  const rHalf = uploadReport(half);
  ck("THE ROOM DATA FAILS AFTER THE MODEL: said plainly, and the villa still reloads to the new model",
     !rHalf.ok && rHalf.reload && /model was uploaded \(12\.3 MB\), but its room data was not: HTTP 413/.test(rHalf.text)
     && /previous rooms until you upload it again/.test(rHalf.text), rHalf);
  order.length = 0;
  const first = await runModelUpload(plan.steps, put("glb"));
  const rFirst = uploadReport(first);
  ck("the model fails: nothing after it is tried, nothing reloads", order.join() === "glb" && !rFirst.ok && !rFirst.reload && rFirst.text === "HTTP 413", { order, rFirst });
  const lone = uploadReport({ written: [{ kind: "rooms", path: "villa.rooms.json", size: 900 }] });
  ck("a lone room-data upload names its own file", lone.ok && lone.text === "Uploaded 1 KB → villa.rooms.json. Reloading…", lone);
}

console.log("\n  who uploads through it:");
{
  const { readFileSync } = await import("node:fs");
  const src = (f) => readFileSync(new URL(`../../src/${f}`, import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\/|(^|[^:])\/\/.*$/gm, "$1");
  const hook = src("components/settings/useGlbUpload.ts");
  const planAt = hook.indexOf("await planModelUpload(files)"), runAt = hook.indexOf("await runModelUpload(plan.steps");
  ck("the hook plans (checks everything) before it writes, and writes only through runModelUpload",
     planAt > 0 && runAt > planAt && (hook.match(/uploadCentralModel\(/g) ?? []).length === 1 && hook.indexOf("uploadCentralModel(") > runAt);
  ck("  ...and adopts the room data as the owner's deliberate replacement", /roomDataPatch\(config, plan\.rooms, "upload"\)/.test(hook));
  const first = src("components/settings/ModelUploader.tsx");
  ck("the no-model screen uploads through the same hook — to the add-on, not this browser",
     /useGlbUpload\(true, onUploaded\)/.test(first) && !/indexedDB|localModel|ingestUploadedModel/i.test(first));
}

done("✅ one operation uploads the villa's model");
