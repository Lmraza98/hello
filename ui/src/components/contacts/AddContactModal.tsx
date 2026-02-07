import { useState } from 'react';
import type { Contact } from '../../api';
import { BaseModal } from '../shared/BaseModal';

type AddContactModalProps = {
  companies: string[];
  onAdd: (contact: Partial<Contact>) => void;
  onClose: () => void;
};

export function AddContactModal({ companies, onAdd, onClose }: AddContactModalProps) {
  const [form, setForm] = useState({
    name: '',
    email: '',
    phone: '',
    company_name: '',
    title: '',
    linkedin_url: '',
  });
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);

  const handleCompanyChange = (value: string) => {
    setForm({ ...form, company_name: value });
    if (value.length > 0) {
      const filtered = companies.filter(c => c.toLowerCase().includes(value.toLowerCase())).slice(0, 8);
      setSuggestions(filtered);
      setShowSuggestions(filtered.length > 0);
    } else {
      setShowSuggestions(false);
    }
  };

  return (
    <BaseModal
      title="Add Contact"
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose} className="px-4 py-2.5 md:py-2 text-sm text-text-muted hover:text-text transition-colors">
            Cancel
          </button>
          <button
            onClick={() => form.name && form.company_name && onAdd(form)}
            disabled={!form.name || !form.company_name}
            className="px-5 py-2.5 md:py-2 bg-accent text-white rounded-lg text-sm font-medium hover:bg-accent-hover disabled:opacity-50 transition-colors"
          >
            Add Contact
          </button>
        </>
      }
    >
      <div>
        <label className="block text-sm font-medium text-text mb-1.5">Name *</label>
        <input
          type="text"
          placeholder="Full name"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          className="w-full px-3 py-2.5 md:py-2 bg-bg border border-border rounded-lg text-sm text-text placeholder:text-text-dim focus:outline-none focus:border-accent"
          autoFocus
        />
      </div>
      <div className="relative">
        <label className="block text-sm font-medium text-text mb-1.5">Company *</label>
        <input
          type="text"
          placeholder="Search or type company name..."
          value={form.company_name}
          onChange={(e) => handleCompanyChange(e.target.value)}
          onFocus={() => form.company_name && handleCompanyChange(form.company_name)}
          onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
          className="w-full px-3 py-2.5 md:py-2 bg-bg border border-border rounded-lg text-sm text-text placeholder:text-text-dim focus:outline-none focus:border-accent"
        />
        {showSuggestions && (
          <div className="absolute left-0 right-0 top-full mt-1 bg-surface border border-border rounded-lg shadow-lg z-10 max-h-40 overflow-y-auto">
            {suggestions.map((c) => (
              <button
                key={c}
                onMouseDown={() => {
                  setForm({ ...form, company_name: c });
                  setShowSuggestions(false);
                }}
                className="w-full px-3 py-2.5 md:py-2 text-left text-sm text-text hover:bg-surface-hover transition-colors"
              >
                {c}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-text mb-1.5">Email</label>
          <input
            type="email"
            placeholder="email@company.com"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            className="w-full px-3 py-2.5 md:py-2 bg-bg border border-border rounded-lg text-sm text-text placeholder:text-text-dim focus:outline-none focus:border-accent"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-text mb-1.5">Phone</label>
          <input
            type="tel"
            placeholder="+1 (555) 000-0000"
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
            className="w-full px-3 py-2.5 md:py-2 bg-bg border border-border rounded-lg text-sm text-text placeholder:text-text-dim focus:outline-none focus:border-accent"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-text mb-1.5">Title</label>
          <input
            type="text"
            placeholder="e.g., VP of Sales"
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            className="w-full px-3 py-2.5 md:py-2 bg-bg border border-border rounded-lg text-sm text-text placeholder:text-text-dim focus:outline-none focus:border-accent"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-text mb-1.5">LinkedIn URL</label>
          <input
            type="url"
            placeholder="https://linkedin.com/in/..."
            value={form.linkedin_url}
            onChange={(e) => setForm({ ...form, linkedin_url: e.target.value })}
            className="w-full px-3 py-2.5 md:py-2 bg-bg border border-border rounded-lg text-sm text-text placeholder:text-text-dim focus:outline-none focus:border-accent"
          />
        </div>
      </div>
    </BaseModal>
  );
}
