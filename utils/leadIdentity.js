/*
|--------------------------------------------------------------------------
| Who the lead actually is
|--------------------------------------------------------------------------
|
| Directory inquiries do not come FROM the lead. They are relayed, so the
| From header is partners@shopify.com (or whichever mailbox forwarded it)
| and the person's name appears only in the subject:
|
|   Shopify Partner Directory: New Service Inquiry from Chris Duthie to
|   The Smith Marketing | Design, Development & Growth Experts
|
| extractFieldsFromEmail() used to read {{FullName}} off the From header,
| which meant the greeting named the relay, the forwarding mailbox, or
| nothing at all — live replies went out saying "Hi RS techlexis" and
| "Hi Malik Muhammad Rehan" to people called neither.
|
| WHAT THIS HANDLES, all seen in real mail:
|
|   - "...Inquiry from Chris Duthie to The Fold Tech – Plus Store..."
|   - "...inquiry from CRO TEST"                    (no " to " suffix)
|   - "...inquiry from ollie@transactions.today to ..."  (email, not a name)
|   - "shopify partner directory: new service inquiry from ..." (lowercased)
|   - "Re: ..." / "Fwd: ..."                        (reply prefixes)
|
| THE BOUNDARY
|
| The name ends at the FIRST " to ", not the last. A partner's company
| name can plausibly contain the word ("Store to Store LLC"); a person's
| name effectively never does. Cutting at the first occurrence therefore
| protects the half we are actually trying to read.
|
| WHEN IT IS AN EMAIL ADDRESS
|
| People paste their address into the name field. Deriving "ollie" from
| ollie@transactions.today would open a business reply with a username,
| so those fall back to a neutral salutation instead.
*/

/* Used when the subject yields no usable human name. */
export const FALLBACK_NAME = 'Sir/Madam';

/* "Re:", "Fwd:", "[Tag]" and friends, repeated. */
const REPLY_PREFIX = /^\s*(?:(?:re|fwd|fw|aw|wg)\s*(?:\[\d+\])?\s*:\s*|\[[^\]]*\]\s*)+/i;

/*
 * Generic marker, used when no configured trigger subject is supplied or
 * the supplied one does not appear. Every real subject reaches the name
 * through the words "inquiry from" / "enquiry from".
 */
const GENERIC_MARKER = /\b(?:inquiry|enquiry|request)\s+from\s+/i;

const looksLikeEmail = (value = '') =>
  /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value.trim());

/*
 * A name that is really "Display Name <addr@host>" — keep the display
 * part, which IS a name, and drop the address.
 */
const stripAngleAddress = (value = '') => {
  const match = value.match(/^(.*?)\s*<[^>]+>$/);
  return match && match[1].trim() ? match[1].trim() : value;
};

const tidy = (value = '') =>
  value
    .replace(/\s+/g, ' ')
    .replace(/^["'`\s]+|["'`\s]+$/g, '')
    /* Trailing sentence punctuation, but never a closing bracket of a
       name like "Chris Duthie (Acme)". */
    .replace(/[.,;:]+$/, '')
    .trim();

/*
 * Is this a name we are willing to greet someone by?
 *
 * Rejects the cases that would read badly in a business reply rather
 * than trying to repair them: an address, a bare URL, something absurdly
 * long (a subject that never had a " to " boundary and swallowed the
 * whole partner name), or something with no letters at all.
 */
const isUsableName = (value = '') => {
  if (!value) return false;
  /*
   * A single character is not a name to greet someone by — "Hi M," reads
   * as a parsing failure, which it usually is.
   */
  if (value.replace(/[^A-Za-z]/g, '').length < 2) return false;
  if (value.length > 60) return false;
  if (looksLikeEmail(value)) return false;
  if (/^https?:\/\//i.test(value)) return false;
  if (!/[A-Za-z]/.test(value)) return false;
  return true;
};

/*
 * Pull the lead's name out of a directory-inquiry subject.
 *
 * triggerSubject is the platform-configured trigger ("Shopify Partner
 * Directory: New service inquiry from"), passed so the parser stays in
 * step with whatever the administrator set. It is a hint, not a
 * requirement: if it does not appear, the generic marker is used.
 *
 * Returns { fullName, firstName, greeting, rawName, isEmail, matched }.
 * fullName / firstName / greeting are always safe to drop into a
 * template — they carry the fallback when no name was found.
 */
export const parseLeadIdentity = (subject = '', triggerSubject = '') => {
  const empty = {
    fullName: FALLBACK_NAME,
    firstName: FALLBACK_NAME,
    greeting: `Dear ${FALLBACK_NAME}`,
    rawName: '',
    isEmail: false,
    matched: false,
    /*
     * True only when the ADMINISTRATOR'S configured trigger subject was
     * the thing that matched, as opposed to the generic "inquiry from"
     * fallback. Callers use it to decide how much to trust the result —
     * see applyLeadIdentity.
     */
    viaConfiguredTrigger: false,
  };

  const clean = String(subject || '').replace(REPLY_PREFIX, '').trim();
  if (!clean) return empty;

  let remainder = '';
  let viaConfiguredTrigger = false;

  /*
   * Prefer the configured trigger. Matched as a plain case-insensitive
   * substring — it is admin-entered text, so it must never be treated as
   * a pattern.
   */
  const configured = String(triggerSubject || '').trim();

  if (configured) {
    const at = clean.toLowerCase().indexOf(configured.toLowerCase());
    if (at !== -1) {
      remainder = clean.slice(at + configured.length);
      viaConfiguredTrigger = true;
    }
  }

  if (!remainder) {
    const generic = clean.match(GENERIC_MARKER);
    if (generic) remainder = clean.slice(generic.index + generic[0].length);
  }

  if (!remainder.trim()) return empty;

  /* Cut at the first " to " — see the note above on why first, not last. */
  const boundary = remainder.match(/\s+to\s+/i);
  const rawName = tidy(
    stripAngleAddress(
      tidy(boundary ? remainder.slice(0, boundary.index) : remainder)
    )
  );

  const isEmail = looksLikeEmail(rawName);

  if (!isUsableName(rawName)) {
    return { ...empty, rawName, isEmail, matched: true, viaConfiguredTrigger };
  }

  /*
   * First token only. "Charleste paul" -> "Charleste", "Mohamed Farag"
   * -> "Mohamed". A single-word name is its own first name.
   *
   * Except when that token is an initial: "M Rehan" would greet someone
   * "Hi M," which reads like the parser broke. The whole name is used
   * instead — "Hi M Rehan," is formal but correct.
   */
  const firstToken = rawName.split(' ')[0];
  const firstName =
    firstToken.replace(/[^A-Za-z]/g, '').length < 2 ? rawName : firstToken;

  return {
    fullName: rawName,
    firstName,
    greeting: `Hi ${firstName}`,
    rawName,
    isEmail: false,
    matched: true,
    viaConfiguredTrigger,
  };
};

/*
 * The three template fields for a name from any source.
 *
 * The subject is one source; the contact form's own "Full name" field is
 * a better one when the mail carries it. Both run through here so an
 * email address pasted into a name field falls back the same way
 * wherever it came from.
 */
export const identityFieldsFromName = (rawName = '') => {
  const clean = tidy(stripAngleAddress(String(rawName || '')));

  if (!isUsableName(clean)) {
    return {
      FullName: FALLBACK_NAME,
      FirstName: FALLBACK_NAME,
      Greeting: `Dear ${FALLBACK_NAME}`,
    };
  }

  const token = clean.split(' ')[0];
  const firstName =
    token.replace(/[^A-Za-z]/g, '').length < 2 ? clean : token;

  return {
    FullName: clean,
    FirstName: firstName,
    Greeting: `Hi ${firstName}`,
  };
};

/*
 * Merge the parsed identity into the template field bag.
 *
 * Only fills what the subject actually yielded — an existing FullName
 * from a genuinely personal From header is left alone, since a relayed
 * subject is the exception, not the rule.
 */
export const applyLeadIdentity = (fields = {}, subject = '', triggerSubject = '') => {
  const identity = parseLeadIdentity(subject, triggerSubject);

  /*
   * A name already read off the From header is only overwritten when the
   * configured trigger matched — that is the case where the From header
   * is known to be a relay. The generic "inquiry from" fallback is a
   * guess, and a guess must not clobber a real name on some other
   * scenario whose subject happens to contain those words.
   */
  if (identity.viaConfiguredTrigger || (identity.matched && !fields.FullName)) {
    fields.FullName = identity.fullName;
  }

  fields.FirstName = identity.matched
    ? identity.firstName
    : fields.FullName || FALLBACK_NAME;

  fields.Greeting = identity.matched
    ? identity.greeting
    : fields.FullName
      ? `Hi ${String(fields.FullName).split(' ')[0]}`
      : `Dear ${FALLBACK_NAME}`;

  /*
   * When the lead typed an address where their name goes, that address
   * is still the best contact detail we have for them — better than the
   * relay's From header, which is what BusinessEmail would otherwise be.
   */
  if (identity.isEmail && identity.rawName) {
    fields.BusinessEmail = identity.rawName;
  }

  return fields;
};
