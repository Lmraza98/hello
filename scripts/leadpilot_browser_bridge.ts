import { startBrowserBridgeServer } from "../openclaw/src/browser/bridge-server.ts";

// Minimal standalone LeadPilot browser bridge server.
//
// This exposes the LeadPilot browser HTTP contract (tabs/navigate/snapshot/act)
// without running the full gateway.
//
// Defaults:
// - Control server: http://127.0.0.1:9223
// - Chrome remote debugging port: 9224
//
// Configure via env:
// - LEADPILOT_BRIDGE_PORT
// - LEADPILOT_CDP_PORT
// - LEADPILOT_HEADLESS ("1" or "0")
// - LEADPILOT_EVALUATE_ENABLED ("1" or "0")
// - LEADPILOT_BROWSER_AUTH_TOKEN (optional bearer token)
// - LEADPILOT_BROWSER_PASSWORD (optional password)
// - LEADPILOT_EXECUTABLE_PATH (optional)
//
// Back-compat (OpenClaw):
// - OPENCLAW_BRIDGE_PORT, OPENCLAW_CDP_PORT, OPENCLAW_HEADLESS, OPENCLAW_EVALUATE_ENABLED
// - OPENCLAW_BROWSER_AUTH_TOKEN, OPENCLAW_BROWSER_PASSWORD, OPENCLAW_EXECUTABLE_PATH

async function main() {
  const port = Number(process.env.LEADPILOT_BRIDGE_PORT ?? process.env.OPENCLAW_BRIDGE_PORT ?? "9223");
  const cdpPort = Number(process.env.LEADPILOT_CDP_PORT ?? process.env.OPENCLAW_CDP_PORT ?? "9224");
  const headless = String(process.env.LEADPILOT_HEADLESS ?? process.env.OPENCLAW_HEADLESS ?? "0") === "1";
  const evaluateEnabled = String(process.env.LEADPILOT_EVALUATE_ENABLED ?? process.env.OPENCLAW_EVALUATE_ENABLED ?? "1") !== "0";
  const authToken = (process.env.LEADPILOT_BROWSER_AUTH_TOKEN ?? process.env.OPENCLAW_BROWSER_AUTH_TOKEN ?? "").trim() || undefined;
  const authPassword = (process.env.LEADPILOT_BROWSER_PASSWORD ?? process.env.OPENCLAW_BROWSER_PASSWORD ?? "").trim() || undefined;
  const executablePath = (process.env.LEADPILOT_EXECUTABLE_PATH ?? process.env.OPENCLAW_EXECUTABLE_PATH ?? "").trim() || undefined;

  if (!Number.isFinite(port) || port <= 0) {
    throw new Error(`Invalid LEADPILOT_BRIDGE_PORT: ${process.env.LEADPILOT_BRIDGE_PORT}`);
  }
  if (!Number.isFinite(cdpPort) || cdpPort <= 0) {
    throw new Error(`Invalid LEADPILOT_CDP_PORT: ${process.env.LEADPILOT_CDP_PORT}`);
  }

  const resolved = {
    enabled: true,
    evaluateEnabled,
    controlPort: port,
    cdpProtocol: "http",
    cdpHost: "127.0.0.1",
    cdpIsLoopback: true,
    remoteCdpTimeoutMs: 1500,
    remoteCdpHandshakeTimeoutMs: 3000,
    color: "#2563eb",
    executablePath,
    headless,
    noSandbox: false,
    attachOnly: false,
    defaultProfile: "leadpilot",
    profiles: {
      leadpilot: {
        cdpPort,
        color: "#2563eb",
      },
    },
  };

  const bridge = await startBrowserBridgeServer({
    resolved,
    host: "127.0.0.1",
    port,
    authToken,
    authPassword,
  });

  process.stdout.write(
    [
      "[leadpilot-bridge] running",
      `baseUrl=${bridge.baseUrl}`,
      `cdp=http://127.0.0.1:${cdpPort}`,
      `headless=${headless}`,
      `evaluateEnabled=${evaluateEnabled}`,
    ].join(" ") + "\n",
  );

  // Keep process alive.
  setInterval(() => {}, 1 << 30);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("[leadpilot-bridge] failed:", err);
  process.exitCode = 1;
});
