import { useEffect, useRef, useState } from 'react';
import { Loader2, X } from 'lucide-react';
import type { Contact } from '../../api';

type AddContactPanelContentProps = {
  companies: string[];
  isSubmitting?: boolean;
  onAdd: (contact: Partial<Contact>) => void;
  onClose: () => void;
};

export function AddContactPanelContent({
  companies,
  isSubmitting = false,
  onAdd,
  onClose,
}: AddContactPanelContentProps) {
  const [form, setForm] = useState({
    name: '',
    email: '',
    phone: '',
    company_name: '',
    location: '',
    title: '',
    linkedin_url: '',
    salesforce_url: '',
  });
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const id = window.requestAnimationFrame(() => nameInputRef.current?.focus());
    return () => window.cancelAnimationFrame(id);
  }, []);

  const handleCompanyChange = (value: string) => {
    setForm((current) => ({ ...current, company_name: value }));
    if (value.length > 0) {
      const filtered = companies.filter((company) => company.toLowerCase().includes(value.toLowerCase())).slice(0, 8);
      setSuggestions(filtered);
      setShowSuggestions(filtered.length > 0);
      return;
    }
    setSuggestions([]);
    setShowSuggestions(false);
  };

  const setField = (field: keyof typeof form, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const canSubmit = form.name.trim().length > 0 && form.company_name.trim().length > 0 && !isSubmitting;

  return (
    <div data-assistant-id="contact-create-panel" data-assistant-panel-id="contact-create-panel" className="flex h-full min-h-0 flex-col">
      <div className="sticky top-0 z-10 shrink-0 border-b border-border bg-surface px-4 py-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold text-text">Create New Contact</h3>
            <p className="truncate text-xs text-text-muted">Add a contact using the same workspace panel flow as contact details.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close new contact panel"
            className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border text-text-muted hover:bg-surface-hover"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!canSubmit) return;
            onAdd(form);
          }}
        >
          <div>
            <label className="mb-1.5 block text-sm font-medium text-text">Name *</label>
            <input
              ref={nameInputRef}
              data-assistant-id="contact-name-input"
              type="text"
              placeholder="Full name"
              value={form.name}
              onChange={(e) => setField('name', e.target.value)}
              className="w-full rounded-lg border border-border bg-bg px-3 py-2.5 text-sm text-text placeholder:text-text-dim focus:border-accent focus:outline-none"
            />
          </div>

          <div className="relative">
            <label className="mb-1.5 block text-sm font-medium text-text">Company *</label>
            <input
              data-assistant-id="contact-company-input"
              type="text"
              placeholder="Search or type company name..."
              value={form.company_name}
              onChange={(e) => handleCompanyChange(e.target.value)}
              onFocus={() => {
                if (form.company_name) handleCompanyChange(form.company_name);
              }}
              onBlur={() => window.setTimeout(() => setShowSuggestions(false), 200)}
              className="w-full rounded-lg border border-border bg-bg px-3 py-2.5 text-sm text-text placeholder:text-text-dim focus:border-accent focus:outline-none"
            />
            {showSuggestions ? (
              <div className="absolute left-0 right-0 top-full z-10 mt-1 max-h-40 overflow-y-auto rounded-lg border border-border bg-surface shadow-lg">
                {suggestions.map((company) => (
                  <button
                    key={company}
                    type="button"
                    onMouseDown={() => {
                      setField('company_name', company);
                      setShowSuggestions(false);
                    }}
                    className="w-full px-3 py-2.5 text-left text-sm text-text transition-colors hover:bg-surface-hover"
                  >
                    {company}
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-text">Email</label>
              <input
                data-assistant-id="contact-email-input"
                type="email"
                placeholder="email@company.com"
                value={form.email}
                onChange={(e) => setField('email', e.target.value)}
                className="w-full rounded-lg border border-border bg-bg px-3 py-2.5 text-sm text-text placeholder:text-text-dim focus:border-accent focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-text">Phone</label>
              <input
                data-assistant-id="contact-phone-input"
                type="tel"
                placeholder="+1 (555) 000-0000"
                value={form.phone}
                onChange={(e) => setField('phone', e.target.value)}
                className="w-full rounded-lg border border-border bg-bg px-3 py-2.5 text-sm text-text placeholder:text-text-dim focus:border-accent focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-text">Location</label>
              <input
                data-assistant-id="contact-location-input"
                type="text"
                placeholder="e.g., Boston, MA"
                value={form.location}
                onChange={(e) => setField('location', e.target.value)}
                className="w-full rounded-lg border border-border bg-bg px-3 py-2.5 text-sm text-text placeholder:text-text-dim focus:border-accent focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-text">Title</label>
              <input
                data-assistant-id="contact-title-input"
                type="text"
                placeholder="e.g., VP of Sales"
                value={form.title}
                onChange={(e) => setField('title', e.target.value)}
                className="w-full rounded-lg border border-border bg-bg px-3 py-2.5 text-sm text-text placeholder:text-text-dim focus:border-accent focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-text">LinkedIn URL</label>
              <input
                data-assistant-id="contact-linkedin-input"
                type="url"
                placeholder="https://linkedin.com/in/..."
                value={form.linkedin_url}
                onChange={(e) => setField('linkedin_url', e.target.value)}
                className="w-full rounded-lg border border-border bg-bg px-3 py-2.5 text-sm text-text placeholder:text-text-dim focus:border-accent focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-text">Salesforce URL</label>
              <input
                data-assistant-id="contact-salesforce-input"
                type="url"
                placeholder="https://yourorg.lightning.force.com/lightning/r/Lead/..."
                value={form.salesforce_url}
                onChange={(e) => setField('salesforce_url', e.target.value)}
                className="w-full rounded-lg border border-border bg-bg px-3 py-2.5 text-sm text-text placeholder:text-text-dim focus:border-accent focus:outline-none"
              />
              {form.salesforce_url ? <p className="mt-1 text-xs text-text-muted">Lead is already in Salesforce</p> : null}
            </div>
          </div>
        </form>
      </div>

      <div className="shrink-0 border-t border-border bg-surface px-4 py-3">
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm text-text-muted transition-colors hover:text-text"
          >
            Cancel
          </button>
          <button
            data-assistant-id="add-contact-submit"
            type="button"
            onClick={() => {
              if (!canSubmit) return;
              onAdd(form);
            }}
            disabled={!canSubmit}
            className="inline-flex items-center gap-2 rounded-lg bg-accent px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {isSubmitting ? 'Adding...' : 'Add Contact'}
          </button>
        </div>
      </div>
    </div>
  );
}
