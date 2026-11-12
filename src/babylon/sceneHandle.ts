// src/babylon/sceneHandle.ts
// The ONE way the rest of the app holds the scene: a view of the SceneManager that BabylonCanvas revokes, in the
// same call, just before it disposes the manager. A call through a revoked view does nothing and returns undefined,
// so no caller has to time its own null.
//
// ⚠️ THE NULL ARRIVED ONE RENDER LATE (2.496.784, owner's report: "Cannot read properties of null (reading
// 'setDeviceMarks')" reloading an edited model). The canvas disposed its scene as it unmounted and said so
// (onManager(null)) only in the next render: an effect of Dashboard whose own value changed in the reload's render
// ran on the disposed shell, whose subsystems dispose() nulls. Dashboard patched that one path; any other effect,
// timer or open dialog holding the manager across a teardown could do the same.
//
// What it covers: the manager's own methods and fields, and one level below (`view.camera.setMovement(...)`,
// `view.sun.applyRealSun()`). What one of those methods returns is the real object, so Babylon's identity checks
// still hold; a caller keeping such a result past a teardown is outside this guard. Revoking also lets go of the
// manager, so a view someone forgot still does not keep the disposed shell reachable (leakWatch's "mgr").
// tests/oracles/scene_handle.mjs.

/** Anything read from a revoked view: every property is itself, a call returns undefined. */
const gone: unknown = new Proxy(function gone() {}, {
  get: (_t, prop) => (prop === "then" ? undefined : gone), // never mistaken for a promise
  apply: () => undefined,
  set: () => true,
});

export interface SceneHandle<T extends object> {
  /** Hand this out in place of the object itself. */
  readonly view: T;
  /** From now on every call through `view` (or a method or field read from it earlier) does nothing. */
  revoke(): void;
}

export function sceneHandle<T extends object>(target: T): SceneHandle<T> {
  let live: T | null = target;
  const views = new Map<PropertyKey, unknown>();

  /** `read` gets the object a view stands for, while it is live. */
  const viewOf = (read: () => object | null, depth: number): object => {
    const methods = new Map<PropertyKey, (...args: unknown[]) => unknown>();
    const fields = depth === 0 ? views : null;
    return new Proxy({}, {
      get(_t, prop) {
        const obj = read();
        if (!obj) return gone;
        const v = Reflect.get(obj, prop, obj);
        if (typeof v === "function") {
          // the same function for the same name, so it can be added and removed as a listener
          let m = methods.get(prop);
          if (!m) {
            m = (...args) => {
              const o = read();
              const f = o ? Reflect.get(o, prop, o) : null;
              return typeof f === "function" ? Reflect.apply(f, o, args) : undefined;
            };
            methods.set(prop, m);
          }
          return m;
        }
        if (fields && v && typeof v === "object") {
          let child = fields.get(prop);
          if (!child) {
            child = viewOf(() => {
              const o = read();
              const c = o ? Reflect.get(o, prop, o) : null;
              return c && typeof c === "object" ? c : null;
            }, depth + 1);
            fields.set(prop, child);
          }
          return child;
        }
        return v;
      },
      set(_t, prop, value) {
        const obj = read();
        return obj ? Reflect.set(obj, prop, value, obj) : true;
      },
      has(_t, prop) {
        const obj = read();
        return !!obj && prop in obj;
      },
    });
  };

  return {
    view: viewOf(() => live, 0) as T,
    revoke() { live = null; views.clear(); },
  };
}
