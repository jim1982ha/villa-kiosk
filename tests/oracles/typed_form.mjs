// A half-filled form is not lost to a touch outside its window (owner, 2026-11-10; common/Window: useFormGuard,
// useTypedForm). "Report a problem", "Open a ticket" and the Cockpit's forms closed with what was typed at a touch on
// the backdrop, Escape or Back. Now those ways out ask "Discard what you typed?" once something is typed; a form with
// nothing typed closes at once; a form that is gone (saved, cancelled) holds nothing.
//
// Driven under React (tests/consistency/fakedom.mjs): the window's real guard and a form's real hook, typed into,
// left, answered.
import { register } from "node:module";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";
import { mountRoot } from "../consistency/fakedom.mjs";
const { React, act, render } = mountRoot();
const h = React.createElement;
const { TypedForms, useFormGuard, useTypedForm, useWindowLeave } = await import("@/components/common/Window");

let win, form, close;
const left = [];
const Form = () => { form = useTypedForm(); close = useWindowLeave(); return null; };
const Win = ({ forms = 1 }) => {
  win = useFormGuard();
  return h(TypedForms.Provider, { value: win.forms }, ...Array.from({ length: forms }, (_, i) => h(Form, { key: i })));
};
const outside = () => act(() => win.guard(() => left.push("closed"))());

await render(h(Win));
await outside();
ck("nothing typed: a touch outside closes the window at once", left.join() === "closed" && !win.asking, { left, asking: win.asking });

left.length = 0;
await act(() => form.onChange());
await outside();
ck("something typed: the window stays, and asks", left.length === 0 && win.asking, { left, asking: win.asking });
await act(() => win.keep());
ck("  ...Keep: the question goes, the window and what was typed stay", left.length === 0 && !win.asking, { left, asking: win.asking });
await act(() => close(() => left.push("closed"))());
ck("  ...the footer's Close asks the same", left.length === 0 && win.asking, { left, asking: win.asking });
await act(() => win.discard());
ck("  ...Discard: the window closes, once", left.join() === "closed" && !win.asking, { left, asking: win.asking });

left.length = 0;
await render(h(Win, { forms: 0 }));                   // the form is gone: saved, or its own Cancel pressed
await outside();
ck("a form that is gone holds nothing: the window closes at once", left.join() === "closed" && !win.asking, { left, asking: win.asking });

left.length = 0;
const Alone = () => { close = useWindowLeave(); return null; };
await render(h(Alone));
close(() => left.push("closed"))();
ck("a footer drawn in no window closes as before", left.join() === "closed", left);

done("✅ a half-filled form asks before a touch outside loses it; an empty one closes at once");
