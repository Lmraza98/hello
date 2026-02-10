import type { ParsedIntent } from '../types/chat';

export function parseIntent(message: string): ParsedIntent {
  const lower = message.toLowerCase().trim();

  // ── Check job / background task status ──
  if (isCheckJobIntent(lower)) {
    return {
      intent: 'check_job',
      entities: {},
      confidence: 1.0,
      raw: message,
    };
  }

  // ── Company research ("tell me about Acme Corp", "research MasTec") ──
  const companyResearchMatch = extractCompanyResearchTarget(message, lower);
  if (companyResearchMatch) {
    return {
      intent: 'company_research',
      entities: { company_name: companyResearchMatch },
      confidence: 0.9,
      raw: message,
    };
  }

  // ── Lead generation (must check before contact_lookup to avoid false matches) ──
  if (isLeadGenerationIntent(lower)) {
    return {
      intent: 'lead_generation',
      entities: {
        industry: extractIndustry(lower),
        location: extractLocation(lower),
        titles: extractTitles(lower),
      },
      confidence: 0.9,
      raw: message,
    };
  }

  const nameCompanyMatch = message.match(
    /(?:find|lookup|search|message|contact|reach out to|email)\s+(.+?)\s+(?:from|at|@)\s+(.+)/i
  );

  if (nameCompanyMatch) {
    const personName = nameCompanyMatch[1].trim();
    const companyName = nameCompanyMatch[2].trim();

    if (/\b(message|email|reach\s?out|contact)\b/i.test(lower)) {
      return {
        intent: 'contact_outreach',
        entities: { person_name: personName, company_name: companyName },
        confidence: 1.0,
        raw: message,
      };
    }

    return {
      intent: 'contact_lookup',
      entities: { person_name: personName, company_name: companyName },
      confidence: 1.0,
      raw: message,
    };
  }

  const findMatch = message.match(
    /(?:find|lookup|search|who is)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)/
  );
  if (findMatch) {
    return {
      intent: 'contact_lookup',
      entities: { person_name: findMatch[1].trim() },
      confidence: 0.8,
      raw: message,
    };
  }

  if (
    (/\b(list|show|view)\b.*\bcampaign/i.test(lower) ||
      /\bcampaigns?\b.*\b(list|show|all)\b/i.test(lower))
  ) {
    return { intent: 'campaign_list', entities: {}, confidence: 1.0, raw: message };
  }

  if (/\b(create|new|start|build)\b.*\bcampaign/i.test(lower)) {
    const nameMatch = message.match(
      /campaign\s+(?:called|named)\s+["']?(.+?)["']?\s*$/i
    );
    return {
      intent: 'campaign_create',
      entities: nameMatch ? { campaign_name: nameMatch[1] } : {},
      confidence: 1.0,
      raw: message,
    };
  }

  if (
    (/\b(pending|queued|unsent|draft)\b.*\bemail/i.test(lower) ||
      /\bemail.*\b(pending|queued|unsent|draft)\b/i.test(lower))
  ) {
    return {
      intent: 'email_list_pending',
      entities: {},
      confidence: 1.0,
      raw: message,
    };
  }

  if (/\bapprove\b.*\bemail/i.test(lower) || /\bemail.*\bapprove\b/i.test(lower)) {
    return { intent: 'email_approve', entities: {}, confidence: 1.0, raw: message };
  }

  if (
    (/\b(active|open)\b.*\bconversation/i.test(lower) ||
      /\bconversation.*\b(active|open|list|show)\b/i.test(lower) ||
      lower === 'conversations')
  ) {
    return { intent: 'conversation_list', entities: {}, confidence: 1.0, raw: message };
  }

  if (/\b(status|stats|overview|dashboard|how.+going|summary)\b/i.test(lower)) {
    return { intent: 'status_check', entities: {}, confidence: 1.0, raw: message };
  }

  if (/\b(help|what can you|commands|how do i|what do you)\b/i.test(lower)) {
    return { intent: 'help', entities: {}, confidence: 1.0, raw: message };
  }

  return { intent: 'unknown', entities: {}, confidence: 0, raw: message };
}

/* ── Lead generation intent detection ── */

function isLeadGenerationIntent(text: string): boolean {
  // Explicit lead generation phrases
  if (/\b(find|generate|get|search for|collect|scrape)\s+(leads|prospects|contacts)\b/.test(text)) return true;
  if (/\b(target|search)\s+(companies|businesses|firms)\b/.test(text)) return true;
  if (/\bfind\s+.+?\s+companies\b/.test(text)) return true;
  if (/\blead\s*(gen|generation)\b/.test(text)) return true;
  // "find leads in construction" / "find leads for healthcare"
  if (/\bleads?\s+(in|for|from)\s+/.test(text)) return true;
  // "prospect into tech companies"
  if (/\bprospect\s+(in|into|for)\b/.test(text)) return true;
  return false;
}

function extractIndustry(text: string): string | null {
  // "find leads for the construction industry"
  // "find leads in healthcare"
  // "target construction companies in new england"
  const patterns = [
    /(?:leads?|prospects?|companies|businesses)\s+(?:in|for|from)\s+(?:the\s+)?([a-z][a-z\s&]+?)(?:\s+(?:industry|sector|companies|businesses|firms|in\s|near\s|targeting|$))/,
    /(?:find|search|target|collect|generate|get)\s+([a-z][a-z\s&]+?)\s+(?:companies|businesses|firms|leads|prospects)/,
    /(?:in|for)\s+(?:the\s+)?([a-z][a-z\s&]+?)\s+(?:industry|sector|space|vertical)/,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      const industry = match[1].trim();
      // Filter out noise words that aren't industries
      if (!['the', 'some', 'more', 'new', 'all'].includes(industry)) {
        return industry;
      }
    }
  }
  return null;
}

function extractLocation(text: string): string | null {
  // Named regions
  const regions: Record<string, string> = {
    'new england': 'new_england',
    'west coast': 'west_coast',
    'east coast': 'east_coast',
    'midwest': 'midwest',
    'southwest': 'southwest',
    'southeast': 'southeast',
    'nationwide': 'nationwide',
    'national': 'nationwide',
  };

  for (const [name, key] of Object.entries(regions)) {
    if (text.includes(name)) return key;
  }

  // "in [Location]" pattern (catch state names, cities, etc.)
  const locMatch = text.match(/\bin\s+([a-z][a-z\s,]+?)(?:\s+(?:targeting|looking|with|that)\b|$)/);
  if (locMatch) {
    const loc = locMatch[1].trim();
    // Check it's not an industry we already captured
    if (loc.length > 2 && !['the', 'a', 'an'].includes(loc)) {
      return loc;
    }
  }

  return null;
}

function extractTitles(text: string): string[] {
  const titlePatterns: Array<{ pattern: RegExp; value: string }> = [
    { pattern: /\bc[- ]?level\b/, value: 'CXO' },
    { pattern: /\bcto\b/, value: 'CTO' },
    { pattern: /\bceo\b/, value: 'CEO' },
    { pattern: /\bcfo\b/, value: 'CFO' },
    { pattern: /\bcoo\b/, value: 'COO' },
    { pattern: /\bcmo\b/, value: 'CMO' },
    { pattern: /\bcio\b/, value: 'CIO' },
    { pattern: /\bvps?\b/, value: 'VP' },
    { pattern: /\bvice\s+president/, value: 'VP' },
    { pattern: /\bdirectors?\b/, value: 'Director' },
    { pattern: /\bhead\s+of\b/, value: 'Head of' },
    { pattern: /\bfounders?\b/, value: 'Founder' },
    { pattern: /\bpresident\b/, value: 'President' },
    { pattern: /\bowner\b/, value: 'Owner' },
    { pattern: /\bpartner\b/, value: 'Partner' },
    { pattern: /\bdecision\s*makers?\b/, value: 'Decision Maker' },
  ];

  const found: string[] = [];
  for (const { pattern, value } of titlePatterns) {
    if (pattern.test(text) && !found.includes(value)) {
      found.push(value);
    }
  }
  return found;
}

/* ── Check job intent detection ── */

function isCheckJobIntent(text: string): boolean {
  if (/\b(check|status|progress|how.?s)\b.*\b(job|task|scraping|scrape|background|running)\b/.test(text)) return true;
  if (/\b(job|task|scraping)\b.*\b(status|check|progress|update)\b/.test(text)) return true;
  if (/\bcheck\s+(contacts?|leads?|companies?)\s+job\b/.test(text)) return true;
  if (/\bwhat.?s\s+running\b/.test(text)) return true;
  return false;
}

/* ── Company research intent detection ── */

function extractCompanyResearchTarget(original: string, _lower: string): string | null {
  // "tell me about [Company]"
  const tellMeAbout = original.match(/(?:tell\s+me\s+about|what\s+(?:does|is|about))\s+(.+?)(?:\s*\?|$)/i);
  if (tellMeAbout) {
    const name = tellMeAbout[1].trim().replace(/\s+do\s*$/i, '');
    if (name.length > 1 && !isGenericWord(name.toLowerCase())) return name;
  }

  // "research [Company]"
  const researchMatch = original.match(/(?:research|look\s+up|investigate)\s+(.+?)(?:\s*\?|$)/i);
  if (researchMatch) {
    const name = researchMatch[1].trim();
    if (name.length > 1 && !isGenericWord(name.toLowerCase())) return name;
  }

  // "is [Company] a good target?"
  const targetMatch = original.match(/is\s+(.+?)\s+a\s+good\s+(?:target|fit|prospect|lead)\b/i);
  if (targetMatch) {
    return targetMatch[1].trim();
  }

  return null;
}

function isGenericWord(word: string): boolean {
  const generic = [
    'this', 'that', 'the', 'it', 'my', 'our', 'their', 'some',
    'campaigns', 'contacts', 'emails', 'companies', 'leads',
    'status', 'help', 'settings', 'pipeline',
  ];
  return generic.includes(word);
}
