export interface PageContextSnapshot {
  route: string;
  filters: Record<string, string | number | boolean | null>;
  listContext?: string;
  selected?: {
    contactId?: number;
    companyId?: number;
    campaignId?: number;
    emailId?: number;
    documentId?: string;
  };
  loadedIds?: {
    contactIds?: number[];
    companyIds?: number[];
    campaignIds?: number[];
    documentIds?: string[];
  };
}
