import { startBrowserBridgeServer } from "../openclaw/src/browser/bridge-server.ts";

// Minimal standalone OpenClaw browser bridge server.
//
// This exposes the OpenClaw browser HTTP contract (tabs/navigate/snapshot/act)
// without running the full OpenClaw gateway.
//
// Defaults:
// - Control server: http://127.0.0.1:9223
// - Chrome remote debugging port: 9224
//
// Configure via env:
// - OPENCLAW_BRIDGE_PORT
// - OPENCLAW_CDP_PORT
// - OPENCLAW_HEADLESS ("1" or "0")
// - OPENCLAW_EVALUATE_ENABLED ("1" or "0")
// - OPENCLAW_BROWSER_AUTH_TOKEN (optional bearer token)
// - OPENCLAW_EXECUTABLE_PATH (optional)

async function main() {
  const port = Number(process.env.OPENCLAW_BRIDGE_PORT ?? "9223");
  const cdpPort = Number(process.env.OPENCLAW_CDP_PORT ?? "9224");
  const headless = String(process.env.OPENCLAW_HEADLESS ?? "0") === "1";
  const evaluateEnabled = String(process.env.OPENCLAW_EVALUATE_ENABLED ?? "1") !== "0";
  const authToken = (process.env.OPENCLAW_BROWSER_AUTH_TOKEN ?? "").trim() || undefined;
  const executablePath = (process.env.OPENCLAW_EXECUTABLE_PATH ?? "").trim() || undefined;

  if (!Number.isFinite(port) || port <= 0) {
    throw new Error(`Invalid OPENCLAW_BRIDGE_PORT: ${process.env.OPENCLAW_BRIDGE_PORT}`);
  }
  if (!Number.isFinite(cdpPort) || cdpPort <= 0) {
    throw new Error(`Invalid OPENCLAW_CDP_PORT: ${process.env.OPENCLAW_CDP_PORT}`);
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
    color: "#FF4500",
    executablePath,
    headless,
    noSandbox: false,
    attachOnly: false,
    defaultProfile: "openclaw",
    profiles: {
      openclaw: {
        cdpPort,
        color: "#FF4500",
      },
    },
  };

  const bridge = await startBrowserBridgeServer({
    resolved,
    host: "127.0.0.1",
    port,
    authToken,
  });

  process.stdout.write(
    [
      "[openclaw-bridge] running",
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
  console.error("[openclaw-bridge] failed:", err);
  process.exitCode = 1;
});
