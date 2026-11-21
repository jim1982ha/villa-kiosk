// The camera's siren button says a command is on its way, as every command button does (usePendingAck), and still
// sounds nothing without a person's own yes (CLAUDE.md: the siren needs a person).
//
// Driven under React itself (tests/consistency/fakedom.mjs): the button's real press (CameraDeviceButtons pressSiren)
// wired to the real waiting hook, as the button wires them, pressed, answered, refused.
import { ck, done } from "../consistency/check.mjs";
import { mountRoot } from "../consistency/fakedom.mjs";
const { React, act, render } = mountRoot();
const h = React.createElement;
const { pressSiren } = await import("@/components/panels/CameraDeviceButtons");
const { usePendingAck } = await import("@/hooks/usePendingAck");

let button;
/** The siren's button: its live state watched, its press through pressSiren, the question kept to be answered. */
function SirenButton({ state, answer }) {
  const { pending, markPending } = usePendingAck(state);
  button = {
    pending,
    press: (asked, calls) => pressSiren({
      sounding: state === "on", siren: "siren.cam_siren", name: "Example Gate Camera",
      ask: (q) => asked.push(q),
      callService: (domain, service) => { calls.push(`${domain}.${service}`); return Promise.resolve(answer); },
      sent: markPending,
    }),
  };
  return null;
}
const OK = { ok: true }, REFUSED = { ok: false, error: new Error("refused") };

{
  await render(h(SirenButton, { state: "off", answer: OK }));
  const asked = [], calls = [];
  await act(() => button.press(asked, calls));
  ck("a press on a quiet siren sends nothing and shows no waiting: it only asks",
     calls.length === 0 && asked.length === 1 && !button.pending, { calls, pending: button.pending });
  await act(() => { /* the question left unanswered */ });
  ck("  ...an unanswered question never sounds it", calls.length === 0 && !button.pending);
  await act(() => asked[0].run());
  ck("  ...the person's yes sounds it once, and the button shows the command on its way",
     calls.join() === "siren.turn_on" && button.pending, { calls, pending: button.pending });
  await render(h(SirenButton, { state: "on", answer: OK }));
  ck("  ...until the siren reports its new state", !button.pending);
}

{
  await render(h(SirenButton, { state: "on", answer: OK }));
  const asked = [], calls = [];
  await act(() => button.press(asked, calls));
  ck("a press on a sounding siren stops it at once, asking nothing, the button waiting for it",
     calls.join() === "siren.turn_off" && asked.length === 0 && button.pending, { calls, asked, pending: button.pending });
  await render(h(SirenButton, { state: "off", answer: OK }));
  ck("  ...until it reports quiet", !button.pending);
}

{
  await render(h(SirenButton, { state: "off", answer: REFUSED }));
  const asked = [], calls = [];
  await act(() => button.press(asked, calls));
  await act(async () => { asked[0].run(); await Promise.resolve(); });
  ck("a sounding the villa refuses stops waiting at once", calls.join() === "siren.turn_on" && !button.pending, button.pending);
}

done("✅ the siren's button waits for the siren after a command, and sounds only on a person's yes");
