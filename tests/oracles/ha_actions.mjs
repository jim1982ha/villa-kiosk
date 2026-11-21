// A screen that only sends or subscribes (a panel's commands, a scene's run, the 3D canvas's live feed) takes
// useHAActions() and is not drawn again when the villa's states change; useHA() readers are (src/ha/HAStateStore.tsx).
// useHA()'s value was rebuilt at every push, so every one of its readers re-rendered, at most every 250 ms, whether it
// read a state or not.
//
// Driven under React itself (tests/consistency/fakedom.mjs): the real provider and its real store, changed through
// the store's own path, the renders of each kind of reader counted.
import { ck, done } from "../consistency/check.mjs";
import { mountRoot } from "../consistency/fakedom.mjs";
const { React, act, render, unmount } = mountRoot();
const h = React.createElement;
// the socket the store makes listens for the device waking (utils/deviceWake); it is never opened here
globalThis.addEventListener ??= () => {};
globalThis.removeEventListener ??= () => {};
const { HAStateProvider, useHA, useHAActions } = await import("@/ha/HAStateStore");

const renders = { actions: 0, state: 0 };
let actions, firstActions, state;
function ActionsOnly() { renders.actions++; actions = useHAActions(); firstActions ??= actions; return null; }
function StateReader() { renders.state++; state = useHA(); return null; }
// React.memo: a parent's render is not what is measured, only the context's
const A = React.memo(ActionsOnly), S = React.memo(StateReader);

await render(h(HAStateProvider, null, h(A), h(S)));
const before = { ...renders };
// a change of the store's state, through its own path: a failed command it reports (entityStore.attach)
await act(() => actions.ws.onServiceError(new Error("no answer"), { entity_id: "light.example" }));
await act(() => actions.ws.onServiceError(new Error("no answer"), { entity_id: "light.example" }));

ck("a useHA() reader is drawn again at each change of the store", renders.state === before.state + 2
   && state.serviceError?.entityIds?.[0] === "light.example", { before, renders });
ck("  ...a useHAActions() reader is not drawn again", renders.actions === before.actions, { before, renders });
ck("  ...and holds the same handles throughout", actions === firstActions
   && ["callService", "subscribe", "subscribeAll", "getEntitiesSnapshot", "connect", "setUnavailableByDesign"].every((k) => typeof actions[k] === "function")
   && actions.ws === state.ws && actions.callService === state.callService);
await unmount();

done("✅ a screen that only sends is not drawn again when the villa's states change");
