// tests/consistency/fakedom.mjs
// Just enough DOM for react-dom/client to MOUNT components that render no host elements, so an oracle can run the
// app's real hooks and providers under React itself (effects, unmount, state updaters, useSyncExternalStore) and
// check what they do over time: a value typed then the dialog closed, a drag then Cancel. A screen's markup is
// react-dom/server's job (jsx.mjs, screen.mjs); this is for behaviour no static render can show.
//
//   import { mountRoot } from "../consistency/fakedom.mjs";
//   const { React, render, unmount } = mountRoot();
//   await render(React.createElement(App));

import { createRequire } from "node:module";

export function installFakeDom() {
  const listeners = () => ({ addEventListener() {}, removeEventListener() {} });
  const doc = {
    ...listeners(), nodeType: 9,
    documentElement: { setAttribute() {}, ...listeners() },
    createElement: () => ({ setAttribute() {}, style: {} }),
  };
  globalThis.document = doc;
  globalThis.window = globalThis.window ?? globalThis;
  globalThis.window.document = doc;
  globalThis.window.matchMedia = () => ({ matches: false, ...listeners() });
  const store = new Map();
  globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.HTMLIFrameElement = class {};
  doc.activeElement = null;
  doc.defaultView = globalThis;
  return {
    ...listeners(), nodeType: 1, tagName: "DIV", nodeName: "DIV", namespaceURI: "http://www.w3.org/1999/xhtml",
    ownerDocument: doc, childNodes: [], firstChild: null, appendChild() {}, removeChild() {}, insertBefore() {}, textContent: "",
  };
}

/** A React root on the fake DOM, with the repo's own React. `render` and `act` wait for effects. */
export function mountRoot() {
  const container = installFakeDom();
  const req = createRequire(new URL("../../package.json", import.meta.url));
  const React = req("react");
  const { createRoot } = req("react-dom/client");
  const root = createRoot(container);
  const act = (fn) => React.act(async () => { await fn(); });
  return { React, act, render: (el) => act(() => root.render(el)), unmount: () => act(() => root.unmount()) };
}
