import { useState, useEffect } from 'react';
import { X, Cloud, Check, AlertTriangle, Loader2, Eye, EyeOff, Trash2 } from 'lucide-react';
import { api } from '../../api';
import type { SalesforceAuthStatus } from '../../api';

type SettingsModalProps = {
  isOpen: boolean;
  onClose: () => void;
};

export function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
  // Salesforce credentials state
  const [sfUsername, setSfUsername] = useState('');
  const [sfPassword, setSfPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [sfAuthStatus, setSfAuthStatus] = useState<SalesforceAuthStatus | null>(null);
  const [sfLoading, setSfLoading] = useState(false);
  const [sfSaving, setSfSaving] = useState(false);
  const [sfMessage, setSfMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [sfTesting, setSfTesting] = useState(false);

  // Load auth status on open
  useEffect(() => {
    if (isOpen) {
      loadSalesforceStatus();
    }
  }, [isOpen]);

  const loadSalesforceStatus = async () => {
    setSfLoading(true);
    try {
      const status = await api.getSalesforceAuthStatus();
      setSfAuthStatus(status);
      if (status.username) {
        setSfUsername(status.username);
      }
    } catch (err) {
      console.error('Failed to load Salesforce auth status:', err);
    } finally {
      setSfLoading(false);
    }
  };

  const handleSaveCredentials = async () => {
    if (!sfUsername.trim() || !sfPassword.trim()) {
      setSfMessage({ type: 'error', text: 'Username and password are required' });
      return;
    }

    setSfSaving(true);
    setSfMessage(null);

    try {
      await api.saveSalesforceCredentials(sfUsername.trim(), sfPassword);
      setSfMessage({ type: 'success', text: 'Credentials saved successfully' });
      setSfPassword(''); // Clear password from UI after save
      await loadSalesforceStatus(); // Refresh status
    } catch (err) {
      setSfMessage({ type: 'error', text: 'Failed to save credentials. Is cryptography package installed?' });
    } finally {
      setSfSaving(false);
    }
  };

  const handleDeleteCredentials = async () => {
    if (!confirm('Are you sure you want to remove your Salesforce credentials?')) {
      return;
    }

    setSfSaving(true);
    setSfMessage(null);

    try {
      await api.deleteSalesforceCredentials();
      setSfMessage({ type: 'success', text: 'Credentials removed' });
      setSfUsername('');
      setSfPassword('');
      await loadSalesforceStatus();
    } catch (err) {
      setSfMessage({ type: 'error', text: 'Failed to remove credentials' });
    } finally {
      setSfSaving(false);
    }
  };

  const handleTestConnection = async () => {
    setSfTesting(true);
    setSfMessage(null);

    try {
      const result = await api.triggerSalesforceReauth();
      if (result.success) {
        setSfMessage({ type: 'success', text: 'Connection test started. Complete MFA if required in the browser viewer.' });
      } else {
        setSfMessage({ type: 'error', text: result.message || 'Test failed' });
      }
    } catch (err) {
      setSfMessage({ type: 'error', text: 'Failed to test connection' });
    } finally {
      setSfTesting(false);
      // Refresh status after a delay
      setTimeout(loadSalesforceStatus, 3000);
    }
  };

  if (!isOpen) return null;

  const renderAuthStatusBadge = () => {
    if (sfLoading) {
      return (
        <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-xs bg-surface-hover text-text-muted">
          <Loader2 className="w-3 h-3 animate-spin" />
          Checking...
        </span>
      );
    }

    if (!sfAuthStatus) return null;

    switch (sfAuthStatus.status) {
      case 'authenticated':
        return (
          <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-xs bg-green-500/10 text-green-600">
            <Check className="w-3 h-3" />
            Authenticated
          </span>
        );
      case 'expired':
        return (
          <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-xs bg-amber-500/10 text-amber-600">
            <AlertTriangle className="w-3 h-3" />
            Session expired
          </span>
        );
      case 'not_configured':
        return (
          <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-xs bg-gray-500/10 text-gray-500">
            Not configured
          </span>
        );
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative bg-surface border border-border rounded-xl shadow-xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border sticky top-0 bg-surface">
          <h2 className="text-lg font-semibold text-text">Settings</h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-surface-hover transition-colors"
          >
            <X className="w-5 h-5 text-text-muted" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-6">
          {/* Salesforce Section */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Cloud className="w-5 h-5 text-accent" />
              <h3 className="font-medium text-text">Salesforce</h3>
              {renderAuthStatusBadge()}
            </div>

            <p className="text-sm text-text-muted mb-4">
              Store your Salesforce credentials to enable automatic login. When your session expires, 
              credentials will be auto-filled so you only need to complete MFA.
            </p>

            {/* Message */}
            {sfMessage && (
              <div
                className={`mb-4 px-3 py-2 rounded-lg text-sm ${
                  sfMessage.type === 'success'
                    ? 'bg-green-500/10 text-green-600'
                    : 'bg-red-500/10 text-red-600'
                }`}
              >
                {sfMessage.text}
              </div>
            )}

            {/* Credentials form */}
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-text mb-1">
                  Salesforce Username
                </label>
                <input
                  type="text"
                  value={sfUsername}
                  onChange={(e) => setSfUsername(e.target.value)}
                  placeholder="user@company.com"
                  className="w-full px-3 py-2 bg-bg border border-border rounded-lg text-text placeholder:text-text-dim focus:outline-none focus:border-accent"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-text mb-1">
                  Password
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={sfPassword}
                    onChange={(e) => setSfPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full px-3 py-2 pr-10 bg-bg border border-border rounded-lg text-text placeholder:text-text-dim focus:outline-none focus:border-accent"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-text-muted hover:text-text"
                  >
                    {showPassword ? (
                      <EyeOff className="w-4 h-4" />
                    ) : (
                      <Eye className="w-4 h-4" />
                    )}
                  </button>
                </div>
                <p className="mt-1 text-xs text-text-dim">
                  Password is encrypted and stored locally on this machine only.
                </p>
              </div>

              {/* Action buttons */}
              <div className="flex items-center gap-2 pt-2">
                <button
                  onClick={handleSaveCredentials}
                  disabled={sfSaving || !sfUsername.trim() || !sfPassword.trim()}
                  className="flex items-center gap-2 px-4 py-2 bg-accent text-white rounded-lg font-medium text-sm hover:bg-accent/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {sfSaving ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Check className="w-4 h-4" />
                  )}
                  Save Credentials
                </button>

                {sfAuthStatus?.status !== 'not_configured' && (
                  <>
                    <button
                      onClick={handleTestConnection}
                      disabled={sfTesting}
                      className="flex items-center gap-2 px-4 py-2 bg-surface-hover text-text rounded-lg font-medium text-sm hover:bg-border transition-colors disabled:opacity-50"
                    >
                      {sfTesting ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : null}
                      Test Connection
                    </button>

                    <button
                      onClick={handleDeleteCredentials}
                      disabled={sfSaving}
                      className="p-2 text-red-500 hover:bg-red-500/10 rounded-lg transition-colors"
                      title="Remove credentials"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Divider */}
          <hr className="border-border" />

          {/* Additional settings sections can go here */}
          <div className="text-center text-sm text-text-dim py-4">
            More settings coming soon...
          </div>
        </div>
      </div>
    </div>
  );
}
