import { useState } from 'react';
import type { Company } from '../../api';
import { BaseModal } from '../shared/BaseModal';

type AddCompanyModalProps = {
  onAdd: (company: Partial<Company>) => void;
  onClose: () => void;
};

export function AddCompanyModal({ onAdd, onClose }: AddCompanyModalProps) {
  const [data, setData] = useState({
    company_name: '',
    tier: 'A',
    vertical: '',
    target_reason: '',
    wedge: '',
  });

  return (
    <BaseModal
      title="Add Company"
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose} className="hidden md:block px-4 py-2 text-sm text-text-muted hover:text-text transition-colors">
            Cancel
          </button>
          <button
            onClick={() => data.company_name && onAdd(data)}
            disabled={!data.company_name}
            className="px-5 py-2 bg-accent text-white rounded-lg text-sm font-medium hover:bg-accent-hover disabled:opacity-50 transition-colors"
          >
            Add Company
          </button>
        </>
      }
    >
      <div>
        <label className="block text-sm font-medium text-text mb-1.5">Company Name *</label>
        <input
          type="text"
          placeholder="Enter company name..."
          value={data.company_name}
          onChange={(e) => setData({ ...data, company_name: e.target.value })}
          className="w-full px-3 py-2.5 md:py-2 bg-bg border border-border rounded-lg text-sm text-text placeholder:text-text-dim focus:outline-none focus:border-accent"
          autoFocus
        />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-text mb-1.5">Tier</label>
          <select
            value={data.tier}
            onChange={(e) => setData({ ...data, tier: e.target.value })}
            className="w-full px-3 py-2.5 md:py-2 bg-bg border border-border rounded-lg text-sm text-text"
          >
            <option value="A">A</option>
            <option value="B">B</option>
            <option value="C">C</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-text mb-1.5">Vertical</label>
          <input
            type="text"
            placeholder="e.g., Construction"
            value={data.vertical}
            onChange={(e) => setData({ ...data, vertical: e.target.value })}
            className="w-full px-3 py-2.5 md:py-2 bg-bg border border-border rounded-lg text-sm text-text placeholder:text-text-dim focus:outline-none focus:border-accent"
          />
        </div>
      </div>
      <div>
        <label className="block text-sm font-medium text-text mb-1.5">Target Reason</label>
        <input
          type="text"
          placeholder="Why target this company?"
          value={data.target_reason}
          onChange={(e) => setData({ ...data, target_reason: e.target.value })}
          className="w-full px-3 py-2.5 md:py-2 bg-bg border border-border rounded-lg text-sm text-text placeholder:text-text-dim focus:outline-none focus:border-accent"
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-text mb-1.5">Wedge</label>
        <input
          type="text"
          placeholder="Entry point or angle..."
          value={data.wedge}
          onChange={(e) => setData({ ...data, wedge: e.target.value })}
          className="w-full px-3 py-2.5 md:py-2 bg-bg border border-border rounded-lg text-sm text-text placeholder:text-text-dim focus:outline-none focus:border-accent"
        />
      </div>
    </BaseModal>
  );
}
