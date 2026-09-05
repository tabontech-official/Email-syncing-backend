/*
|--------------------------------------------------------------------------
| The Shopify Partner Directory contact form
|--------------------------------------------------------------------------
|
| A directory inquiry is relayed by Shopify. partners@shopify.com is the
| SENDER, and replying to it reaches Shopify's relay, not the person who
| enquired — the mail itself says so:
|
|   "please follow up with ollie@transactions.today directly by
|    selecting 'Reply all' when you reach out."
|
| The lead's real address is in the body, inside a plain-text form:
|
|   --------------
|   Business email
|   --------------
|
|   ollie@transactions.today
|
| This reads that form. Every field the templates already reference is in
| there — name, email, store, country, service, budget, the enquiry text —
| and none of it was being read: extractFieldsFromEmail() looked for
| "Key: value" lines and a quoted store name, neither of which this
| format uses. So {{StoreName}}, {{Budget}}, {{Country}} and
| {{ProblemGoal}} all resolved to empty on exactly the mail they were
| written for.
|
| SHAPE
|
| Each field is a label fenced by rules of hyphens, then a blank line,
| then the value, which runs until the next rule opens the next field.
| Labels wrap across lines when they are long, so they are joined before
| being matched.
|
| The parser is deliberately tolerant: an unrecognised label is ignored
| rather than fatal, and if the form is missing entirely the caller falls
| back to what it had before. Shopify can change this layout at any time
| and a lead must never be dropped because of it.
*/

/* A fence: a line of nothing but hyphens. */
const RULE = /^-{3,}$/;

/* Where Shopify's own sign-off starts — never part of a field value. */
const SIGNOFF =
  /^(?:Thank you for being a part of the Shopify Partner Directory|Sincerely,|The Shopify Team|©\s*Shopify)/i;

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

const isEmailAddress = (value = '') =>
  /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(value.trim());

/*
 * Plain text, whatever we were handed. The relay sends both parts; if a
 * connection only stored the HTML one, the same form is in there with
 * tags around it.
 */
const toPlainText = (input = '') => {
  const raw = String(input || '');
  if (!/<[a-z][\s\S]*>/i.test(raw)) return raw;

  return raw
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6]|table)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, ' ');
};

/* Label text -> a key we can switch on. */
const labelKey = (label = '') =>
  label.toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, ' ').trim();

/*
 * Split the fenced form into { label, value } pairs.
 *
 * Rules arrive in pairs around each label, so the lines between rule N
 * and rule N+1 are a label, and everything after rule N+1 up to rule N+2
 * is that label's value.
 */
const readSections = (text = '') => {
  const lines = text.split(/\r?\n/);
  const ruleAt = [];

  lines.forEach((line, i) => {
    if (RULE.test(line.trim())) ruleAt.push(i);
  });

  const sections = [];

  for (let i = 0; i + 1 < ruleAt.length; i += 2) {
    const open = ruleAt[i];
    const close = ruleAt[i + 1];

    const label = lines
      .slice(open + 1, close)
      .map((l) => l.trim())
      .filter(Boolean)
      .join(' ');

    if (!label) continue;

    /* The value ends where the next field's opening rule begins. */
    const nextOpen = ruleAt[i + 2] !== undefined ? ruleAt[i + 2] : lines.length;

    const valueLines = [];

    for (const line of lines.slice(close + 1, nextOpen)) {
      if (SIGNOFF.test(line.trim())) break;
      valueLines.push(line);
    }

    sections.push({
      label,
      key: labelKey(label),
      value: valueLines.join('\n').trim(),
    });
  }

  return sections;
};

/*
 * Read a Partner Directory inquiry.
 *
 * Returns only what was actually found — an absent field is absent, not
 * an empty string, so callers can tell "the form said nothing" apart
 * from "the form said blank" and keep whatever they already had.
 */
/*
 * The same form, without the dashed rules.
 *
 * readSections() needs a label fenced by lines of hyphens, which is how
 * the relay's PLAIN-TEXT part is laid out. The HTML part carries the very
 * same form as `<strong>Label</strong><br>value`, and once tags are
 * stripped that becomes a label line followed by its value — no fences,
 * so readSections finds nothing at all.
 *
 * That mattered: a connection that stored only the HTML part, or any
 * message whose text part is just the customer's description, yielded no
 * service. The router then fell through to scanning prose for a service
 * name, found none, and answered on the General template — the exact
 * complaint this parser exists to prevent.
 *
 * Only the fields the router and the templates actually need are read
 * back this way, and only to fill gaps the fenced parse left.
 */
const readLabelledLines = (text = '') => {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, ' ').trim());

  const found = {};

  /* The first non-empty line after `i` — the value sits under its label. */
  const valueAfter = (i) => {
    for (let j = i + 1; j < Math.min(i + 4, lines.length); j += 1) {
      if (lines[j]) return lines[j];
    }
    return '';
  };

  lines.forEach((line, i) => {
    const key = labelKey(line.replace(/:$/, ''));

    if (!found.service && key.startsWith('select a service')) {
      found.service = valueAfter(i);
      return;
    }

    if (!found.fullName && key === 'full name') {
      found.fullName = valueAfter(i);
      return;
    }

    if (!found.country && key === 'country') {
      found.country = valueAfter(i);
      return;
    }

    if (!found.budget && key.startsWith('budget')) {
      found.budget = valueAfter(i);
      return;
    }

    if (!found.businessEmail && (key === 'business email' || key === 'email')) {
      const match = valueAfter(i).match(EMAIL);
      if (match) found.businessEmail = match[0];
    }
  });

  return found;
};

export const parseShopifyInquiry = (body = '') => {
  const text = toPlainText(body);
  const found = {};

  if (!text.trim()) return found;

  for (const section of readSections(text)) {
    const { key, value } = section;
    if (!value) continue;

    if (key === 'full name') {
      found.fullName = value.split(/\r?\n/)[0].trim();
      continue;
    }

    if (key === 'business email' || key === 'email') {
      /*
       * Take the address out of the value rather than trusting the whole
       * line — some layouts put a name beside it.
       */
      const match = value.match(EMAIL);
      if (match) found.businessEmail = match[0];
      continue;
    }

    if (key.includes('store you') && key.includes('working on')) {
      /*
       * Two things under one label: the store's name, then its URL on a
       * later line.
       */
      const parts = value
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);

      const urlLine = parts.find((l) => /^https?:\/\//i.test(l));
      const nameLine = parts.find((l) => !/^https?:\/\//i.test(l));

      if (nameLine) found.storeName = nameLine;
      if (urlLine) found.storeUrl = urlLine;
      continue;
    }

    if (key === 'country') {
      found.country = value.split(/\r?\n/)[0].trim();
      continue;
    }

    if (key.startsWith('select a service')) {
      found.service = value.split(/\r?\n/)[0].trim();
      continue;
    }

    if (key.startsWith('budget')) {
      found.budget = value.split(/\r?\n/)[0].trim();
      continue;
    }

    if (key.includes('problem') && key.includes('goal')) {
      found.problemGoal = value.replace(/\s+/g, ' ').trim();
      continue;
    }
  }

  /*
   * Fill anything the fenced layout did not yield. Never overwrites — a
   * value read from a properly fenced section is the more reliable of the
   * two, so the fallback only adds what is missing.
   */
  const labelled = readLabelledLines(text);

  Object.keys(labelled).forEach((key) => {
    if (!found[key] && labelled[key]) found[key] = labelled[key];
  });

  return found;
};

/*
 * Where a reply to this lead should actually go.
 *
 * Prefers the form's Business email. Failing that — a layout change, a
 * truncated body — it takes the first address in the body that is not
 * the relay itself and not the mailbox that received it, which is how
 * the lead's address appears in the relay's own prose ("X has expressed
 * interest in your services").
 *
 * Returns null when nothing trustworthy is found, so the caller keeps
 * its existing recipient rather than guessing.
 */
export const resolveLeadReplyAddress = (
  body = '',
  { fromAddress = '', receivedAt = '' } = {}
) => {
  const parsed = parseShopifyInquiry(body);

  if (parsed.businessEmail) return parsed.businessEmail;

  const text = toPlainText(body);

  /*
   * The prose fallback only applies to mail that IS a relayed directory
   * inquiry.
   *
   * Unrestricted, it redirected ordinary mail: a thread genuinely from
   * support@tabontech.com was answered at an address merely mentioned
   * in its body. When the sender is the customer, the sender is the
   * right recipient — so anything without the directory's fingerprints
   * keeps its sender.
   */
  const looksRelayed =
    /partner directory/i.test(text) ||
    /contact form submission/i.test(text) ||
    /has expressed interest in your services/i.test(text) ||
    Object.keys(parsed).length > 0;

  if (!looksRelayed) return null;
  const candidates = text.match(EMAIL) || [];

  /*
   * Excluded: the relay's own domain (shopify.com and its senders), the
   * mailbox this arrived at, and anything on that mailbox's domain —
   * replying to the partner's own address would loop.
   */
  const senderDomain = String(fromAddress).split('@')[1]?.toLowerCase() || '';
  const ownAddress = String(receivedAt).toLowerCase();
  const ownDomain = ownAddress.split('@')[1] || '';

  const usable = candidates.find((candidate) => {
    const address = candidate.toLowerCase();
    const domain = address.split('@')[1] || '';

    if (address === String(fromAddress).toLowerCase()) return false;
    if (address === ownAddress) return false;
    if (senderDomain && domain === senderDomain) return false;
    if (ownDomain && domain === ownDomain) return false;
    if (/(^|\.)shopify\.com$/i.test(domain)) return false;
    /* Relay plumbing, never a person. */
    if (/^(?:no-?reply|do-?not-?reply|postmaster|mailer-daemon)@/i.test(address))
      return false;

    return true;
  });

  return usable || null;
};

export { isEmailAddress };
