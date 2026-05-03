interface SpamInput {
  from_address: string;
  from_name: string | null;
  to_addresses: string;
  subject: string;
  body_text?: string | null;
}

interface SpamResult {
  score: number;
  signals: string[];
}

const SUSPICIOUS_SUBJECT =
  /\b(invoice|statement|verify|urgent|immediately|suspended|confirm your|update your account|lottery|winner|congratulations|act now|limited time|expir(e|ing|ed)|security alert|unusual activity|payment (failed|declined|overdue))\b/i;

const SUSPICIOUS_BODY =
  /\b(click here|verify your|confirm your identity|update your (payment|billing|account)|unauthorized (access|activity)|your account (has been|will be)|dear (customer|user|valued)|reset your password|claim your|won a)\b/i;

interface BrandCheck {
  pattern: RegExp;
  legit: string;
  domains: string[];
}

const BRAND_CHECKS: BrandCheck[] = [
  {
    pattern: /[nm][\W]?[0o][\W]?r[\W]?[t7][\W]?[0o][\W]?n/gi,
    legit: 'norton',
    domains: ['norton.com', 'nortonlifelock.com', 'gen.digital'],
  },
  {
    pattern: /p[a@4]yp[a@4][l1]/gi,
    legit: 'paypal',
    domains: ['paypal.com', 'paypal.co.uk'],
  },
  {
    pattern: /[a@4]m[a@4]z[0o]n/gi,
    legit: 'amazon',
    domains: ['amazon.com', 'amazon.co.uk', 'amazon.de', 'amazon.fr', 'amazon.com.au'],
  },
  {
    pattern: /m[i1!]cr[0o]s[0o]ft/gi,
    legit: 'microsoft',
    domains: ['microsoft.com', 'outlook.com', 'live.com', 'office.com'],
  },
  {
    pattern: /[a@4]pp[l1][e3]/gi,
    legit: 'apple',
    domains: ['apple.com', 'icloud.com'],
  },
  {
    pattern: /g[0o]{2}g[l1][e3]/gi,
    legit: 'google',
    domains: ['google.com', 'gmail.com', 'youtube.com', 'googleapis.com'],
  },
  {
    pattern: /w[e3][l1]{2}sf[a@4]rg[0o]/gi,
    legit: 'wellsfargo',
    domains: ['wellsfargo.com'],
  },
  {
    pattern: /[b8][a@4]nk\s*of\s*[a@4]m[e3]r[i1!]c[a@4]/gi,
    legit: 'bankofamerica',
    domains: ['bankofamerica.com', 'bofa.com'],
  },
];

function stripNonAlpha(s: string): string {
  return s.replace(/[^a-z0-9]/gi, '').toLowerCase();
}

function hasObfuscatedBrand(text: string, fromDomain: string): boolean {
  for (const brand of BRAND_CHECKS) {
    brand.pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = brand.pattern.exec(text)) !== null) {
      const stripped = stripNonAlpha(match[0]);
      if (stripped === brand.legit) continue;
      if (brand.domains.some((d) => fromDomain.endsWith(d))) continue;
      return true;
    }
  }
  return false;
}

const SUSPICIOUS_TLDS = /\.(xyz|top|club|buzz|wang|win|bid|stream|gq|ml|cf|tk|ga|icu|rest)$/i;

const AUTO_GENERATED_RECIPIENT = /[a-z]{3,}\d{4,}@/i;

export function scoreSpam(msg: SpamInput, whitelist?: string[]): SpamResult {
  const domain = msg.from_address.split('@')[1] || '';
  if (whitelist && whitelist.some((d) => domain.endsWith(d))) {
    return { score: 0, signals: [] };
  }

  const signals: string[] = [];

  if (SUSPICIOUS_SUBJECT.test(msg.subject)) {
    signals.push('suspicious_subject');
  }

  const combined = `${msg.subject} ${msg.body_text || ''}`;
  if (hasObfuscatedBrand(combined, domain)) {
    signals.push('obfuscated_brand');
  }

  if (AUTO_GENERATED_RECIPIENT.test(msg.to_addresses)) {
    signals.push('auto_generated_recipient');
  }

  if (msg.from_name && msg.from_address) {
    const nameParts = msg.from_name
      .toLowerCase()
      .split(/[\s.]+/)
      .filter((p) => p.length > 2);
    const localPart = msg.from_address.split('@')[0].toLowerCase();
    if (nameParts.length >= 2 && !nameParts.some((p) => localPart.includes(p))) {
      signals.push('name_address_mismatch');
    }
  }

  if (SUSPICIOUS_TLDS.test(domain)) {
    signals.push('suspicious_tld');
  }

  if (msg.body_text && SUSPICIOUS_BODY.test(msg.body_text)) {
    signals.push('suspicious_body');
  }

  const WEIGHTS: Record<string, number> = {
    suspicious_subject: 2,
    obfuscated_brand: 4,
    auto_generated_recipient: 2,
    name_address_mismatch: 1,
    suspicious_tld: 2,
    suspicious_body: 2,
  };

  const score = signals.reduce((sum, s) => sum + (WEIGHTS[s] || 1), 0);
  return { score, signals };
}

export const SPAM_THRESHOLD = 3;

export const SIGNAL_LABELS: Record<string, string> = {
  suspicious_subject: 'Suspicious subject keywords',
  obfuscated_brand: 'Obfuscated brand name',
  auto_generated_recipient: 'Auto-generated recipient address',
  name_address_mismatch: "Sender name doesn't match email",
  suspicious_tld: 'Suspicious domain',
  suspicious_body: 'Suspicious body content',
};
