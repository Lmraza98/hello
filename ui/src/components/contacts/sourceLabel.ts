type SourceInput = {
  salesforce_status?: string | null;
  lead_source?: string | null;
};

export function getContactSourceLabel(contact: SourceInput): 'Small Business Expo' | 'LinkedIn' {
  const status = String(contact.salesforce_status || '')
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ');
  const leadSource = String(contact.lead_source || '')
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ');
  if (
    leadSource.includes('small business expo') ||
    leadSource.includes('website form')
  ) {
    return 'Small Business Expo';
  }
  if (status.startsWith('inbound')) return 'Small Business Expo';
  return 'LinkedIn';
}
