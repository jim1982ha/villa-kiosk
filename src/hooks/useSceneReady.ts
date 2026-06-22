// src/hooks/useSceneReady.ts
import { useEffect, useState } from "react";
import type { SceneManager } from "@/babylon/SceneManager";

/** Resolves true once the Babylon scene + model have finished loading. */
export function useSceneReady(manager: SceneManager | null): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!manager) return;
    if (manager.isReady()) {
      setReady(true);
      return;
    }
    const off = manager.onReady(() => setReady(true));
    return off;
  }, [manager]);
  return ready;
}
