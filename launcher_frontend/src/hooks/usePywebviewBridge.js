import { useEffect, useState } from "react";

function getBridge() {
  return window.pywebview?.api || null;
}

export function usePywebviewBridge() {
  const [bridge, setBridge] = useState(null);
  const [bridgeError, setBridgeError] = useState("");

  useEffect(() => {
    let alive = true;
    let tries = 0;

    const attach = () => {
      const b = getBridge();
      if (!alive) return;
      if (b) {
        setBridge(b);
        setBridgeError("");
      } else if (tries > 120) {
        setBridgeError("window.pywebview.api not available. Open via python launcher.py.");
      }
    };

    const onReady = () => attach();
    window.addEventListener("pywebviewready", onReady);

    const id = window.setInterval(() => {
      tries += 1;
      attach();
      if (getBridge()) window.clearInterval(id);
    }, 150);

    attach();

    return () => {
      alive = false;
      window.clearInterval(id);
      window.removeEventListener("pywebviewready", onReady);
    };
  }, []);

  return { bridge, bridgeError };
}
