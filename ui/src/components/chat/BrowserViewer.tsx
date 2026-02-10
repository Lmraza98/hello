import { useEffect, useRef, useState } from 'react';
import {
  Maximize2,
  Minimize2,
  Monitor,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react';

interface BrowserViewerProps {
  isOpen: boolean;
  onClose: () => void;
  wsUrl?: string;
}

type ViewerStatus = 'connecting' | 'connected' | 'disconnected';

export function BrowserViewer({ isOpen, onClose, wsUrl }: BrowserViewerProps) {
  const [frame, setFrame] = useState<string | null>(null);
  const [status, setStatus] = useState<ViewerStatus>('connecting');
  const [expanded, setExpanded] = useState(false);
  const [currentAction, setCurrentAction] = useState<string>('Browser Automation');
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    const url = wsUrl || resolveBrowserStreamUrl();
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => setStatus('connected');
    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === 'frame' && data.data) {
        setFrame(`data:image/jpeg;base64,${data.data}`);
      } else if (data.type === 'browser_automation_start') {
        setCurrentAction(data.action || 'Browser Automation');
      } else if (data.type === 'browser_automation_stop') {
        // Keep the viewer open so the last frame is inspectable.
        // User can close manually.
      } else if (data.type === 'salesforce_mfa_required') {
        setCurrentAction('Salesforce MFA required');
      } else if (data.type === 'salesforce_auth_required') {
        setCurrentAction('Salesforce re-authentication');
      } else if (data.type === 'salesforce_auth_success') {
        setCurrentAction('Salesforce authenticated');
      } else if (data.type === 'salesforce_auth_failed') {
        setCurrentAction('Salesforce auth failed');
      }
    };
    ws.onerror = () => setStatus('disconnected');
    ws.onclose = () => setStatus('disconnected');

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [isOpen, wsUrl]);

  if (!isOpen) return null;

  const height = expanded ? 'h-[52vh] md:h-[66vh]' : 'h-[34vh] md:h-[44vh]';

  return (
    <div
      className={`${height} flex flex-col overflow-hidden rounded-xl border border-border bg-transparent transition-all duration-300`}
    >
      <div className="flex items-center justify-between border-b border-border px-2.5 py-1.5">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" />
            <span className="text-[11px] font-medium text-text">Live</span>
          </span>
          <span className="text-[11px] text-text-dim">{currentAction}</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setExpanded((prev) => !prev)}
            className="p-1 text-text-dim transition-colors hover:text-text"
            title={expanded ? 'Compact view' : 'Expanded view'}
          >
            {expanded ? (
              <Minimize2 className="h-3.5 w-3.5" />
            ) : (
              <Maximize2 className="h-3.5 w-3.5" />
            )}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-text-dim transition-colors hover:text-text"
            title="Close viewer"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="flex flex-1 items-center justify-center overflow-hidden bg-transparent p-1">
        {frame ? (
          <img
            src={frame}
            alt="Browser automation stream"
            className="h-full w-full rounded-lg border border-border/80 object-contain"
          />
        ) : (
          <div className="flex flex-col items-center gap-1.5 text-text-dim">
            <Monitor className="h-8 w-8 opacity-40" />
            <span className="text-xs">
              {status === 'connecting'
                ? 'Connecting to browser stream...'
                : 'Waiting for automation...'}
            </span>
          </div>
        )}
      </div>

      <div className="flex items-center gap-3 border-t border-border px-2.5 py-1">
        <span className="inline-flex items-center gap-1 text-[10px]">
          {status === 'connected' ? (
            <>
              <Wifi className="h-3 w-3 text-green-400" />
              <span className="text-green-600">Connected</span>
            </>
          ) : (
            <>
              <WifiOff className="h-3 w-3 text-text-dim" />
              <span className="text-text-dim">
                {status === 'connecting' ? 'Connecting...' : 'Disconnected'}
              </span>
            </>
          )}
        </span>
      </div>
    </div>
  );
}

function resolveBrowserStreamUrl(): string {
  const wsProtocol = window.location.protocol === 'https:' ? 'wss' : 'ws';

  // In dev, Vite typically serves UI on :5173 and API on :8000.
  if (import.meta.env.DEV) {
    return `${wsProtocol}://${window.location.hostname}:8000/ws/browser-stream`;
  }

  return `${wsProtocol}://${window.location.host}/ws/browser-stream`;
}
