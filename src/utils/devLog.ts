// src/utils/devLog.ts
// Verbose diagnostic logging that is compiled out of production builds.
// Vite statically replaces `import.meta.env.DEV` with `false` in `vite build`,
// so these calls (and their string-building arguments) are tree-shaken away —
// keeping the production console clean while preserving dev-time insight.

export function devLog(...args: unknown[]): void {
  if (import.meta.env.DEV) console.log(...args);
}
