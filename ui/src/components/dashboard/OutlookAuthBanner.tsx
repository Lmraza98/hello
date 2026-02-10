import { useState } from 'react';
import {
  Mail,
  Loader2,
  Link,
  ExternalLink,
  Copy,
  CheckCircle2,
} from 'lucide-react';

export interface OutlookAuthBannerProps {
  outlookConnected: boolean;
  outlookAuthFlow: {
    verification_uri: string;
    user_code: string;
  } | null;
  connectOutlook: () => void;
  connectOutlookLoading: boolean;
  disconnectOutlook: () => void;
  cancelOutlookAuth: () => void;
}

export function OutlookAuthBanner({
  outlookConnected,
  outlookAuthFlow,
  connectOutlook,
  connectOutlookLoading,
  cancelOutlookAuth,
}: OutlookAuthBannerProps) {
  const [codeCopied, setCodeCopied] = useState(false);

  // Don't render if already connected
  if (outlookConnected) {
    return null;
  }

  // Device-code auth flow in progress
  if (outlookAuthFlow) {
    return (
      <div className="mb-3 p-4 bg-blue-50 border border-blue-200 rounded-lg">
        <div className="flex items-start gap-3">
          <Loader2 className="w-5 h-5 text-blue-600 animate-spin shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-blue-900 mb-2">Sign in to Microsoft</p>
            <div className="flex flex-wrap items-center gap-3">
              <a
                href={outlookAuthFlow.verification_uri}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-700 bg-white border border-blue-200 rounded px-2.5 py-1.5 hover:bg-blue-50 transition-colors"
              >
                {outlookAuthFlow.verification_uri}
                <ExternalLink className="w-3 h-3" />
              </a>
              <div className="inline-flex items-center gap-2">
                <code className="text-base font-mono font-bold text-blue-900 bg-white border border-blue-200 rounded px-3 py-1 tracking-widest select-all">
                  {outlookAuthFlow.user_code}
                </code>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(outlookAuthFlow.user_code);
                    setCodeCopied(true);
                    setTimeout(() => setCodeCopied(false), 2000);
                  }}
                  className="flex items-center gap-1 px-2 py-1.5 text-xs text-blue-600 bg-white border border-blue-200 rounded hover:bg-blue-50 transition-colors"
                >
                  {codeCopied ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  {codeCopied ? 'Copied' : 'Copy'}
                </button>
              </div>
            </div>
            <p className="text-[10px] text-blue-500 mt-2">Waiting for sign-in...</p>
          </div>
          <button onClick={cancelOutlookAuth} className="text-xs text-blue-400 hover:text-blue-600">
            Cancel
          </button>
        </div>
      </div>
    );
  }

  // Initial connection prompt
  return (
    <div className="flex items-center gap-3 bg-blue-50 border border-blue-100 rounded-lg px-4 py-2.5 mb-3">
      <Mail className="w-4 h-4 text-blue-500 shrink-0" />
      <p className="text-xs text-blue-700 flex-1">Connect Outlook to monitor inbox replies automatically.</p>
      <button
        onClick={() => connectOutlook()}
        disabled={connectOutlookLoading}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-60"
      >
        {connectOutlookLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Link className="w-3 h-3" />}
        Connect
      </button>
    </div>
  );
}
