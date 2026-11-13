// src/ha/restartSettle.ts
// How long the villa's system is let settle after a restart before what it says is believed: the agreement's
// `restartSettle` (agent-contract.json), the one value the VESTA Agent reads too (owner, 2026-11-13: "the same 5min
// parameter shall be used for both"). The socket's own watchdog reads it (HAWebSocket.QUIET_LIMIT_MS).

import CONTRACT from "../../rootfs/usr/share/vesta/agent-contract.json" with { type: "json" };

export const RESTART_SETTLE_MS = CONTRACT.restartSettle.minutes * 60_000;
