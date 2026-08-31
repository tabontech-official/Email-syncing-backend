import { ScenarioTriggerConfigModel } from '../Models/ScenarioTriggerConfig.js';

/*
|--------------------------------------------------------------------------
| Platform rules — loader and cache
|--------------------------------------------------------------------------
|
| loadPlatformRules() sits on the incoming-mail path, which runs once per
| message, and on the inbox query, which runs on every refresh. Reading a
| single-document collection that often is pointless work, so the result is
| held in memory for a short window.
|
| The TTL is what makes an edit in the master admin panel take effect
| without a restart; saving also invalidates directly, so the wait only
| applies to other processes in a multi-instance deployment.
|
| SYNCHRONOUS CALLERS
|
| Some consumers are sync helpers on a hot path (subject normalisation in
| threading). They read getCachedRules(), which returns the last loaded
| snapshot, or the built-ins if nothing has been loaded yet. Every request
| that reaches those helpers has already awaited loadPlatformRules()
| upstream, so the snapshot is warm; the built-in fallback only applies on
| the very first call after a cold start, where it reproduces the previous
| hardcoded behaviour exactly.
*/

/*
 * Shipped defaults. These are what the platform behaves like before an
 * owner ever opens the configuration page, and what it falls back to if
 * the config document cannot be read. They reproduce the values that used
 * to be hardcoded across the codebase.
 */
export const BUILT_IN_TRIGGERS = [
  {
    scenarioType: 'shopify',
    label: 'Shopify Partner Directory',
    subjectFilter: 'Shopify Partner Directory: New service inquiry from',
    matchMode: 'contains',
    enabled: true,
  },
];

export const BUILT_IN_REPLY_RULES = {
  subjectPrefixes: ['re', 'fwd', 'fw', 'aw', 'wg'],
  stripBracketTags: true,
  requireReplyMarkerForSubjectMatch: true,
  duplicateWindowSeconds: 10,
};

export const BUILT_IN_INBOX_RULES = {
  excludedSubjects: ['Welcome to Replex Engine'],
  excludedSenders: [],
  internalDomains: [
    'replexengine.com',
    'mail.replexengine.com',
    'shopifyexpertsteam.com',
    '2014tabontech',
  ],
};

/*
 * The service routing list, in priority order — the first entry found in
 * a lead's subject or body wins. This is the order that shipped, kept
 * exactly so behaviour is unchanged until an owner reorders it.
 */
export const BUILT_IN_SERVICES = [
  'General',
  'Troubleshooting',
  'Theme customization',
  'Store build or redesign',
  'Store migration',
  'Website and marketing content',
  'SEO',
  'Site performance and speed',
  'Custom apps and integrations',
  'Store settings configuration',
  'Product and collection setup',
  'Social media marketing',
  'Product descriptions',
  'Search engine advertising',
  'POS setup and migration',
  'Custom domain setup',
  'Conversion rate optimization',
  'Analytics and tracking',
  'Sales channel setup',
  'Logo and visual branding',
  'Business strategy guidance',
  'Website audit and optimization strategy',
  'Sales tax guidance',
  'Product photography',
  'Email marketing',
  '3D modelling',
  'Banner ads',
  'Video and illustrations',
  'Content marketing',
  'Product sourcing guidance',
];

export const BUILT_IN_SERVICE_ROUTING = {
  list: BUILT_IN_SERVICES,
  fallback: 'General',
};

const CACHE_TTL_MS = 60 * 1000;

let cache = null;
let cachedAt = 0;

/* Normalised into a { [scenarioType]: trigger } map for O(1) lookup. */
const toTriggerMap = (triggers = []) => {
  const map = {};

  triggers.forEach((trigger) => {
    const key = String(trigger?.scenarioType || '').trim().toLowerCase();
    if (!key) return;

    map[key] = {
      scenarioType: key,
      label: trigger.label || '',
      subjectFilter: String(trigger.subjectFilter || '').trim(),
      matchMode: trigger.matchMode === 'startsWith' ? 'startsWith' : 'contains',
      enabled: trigger.enabled !== false,
    };
  });

  return map;
};

const cleanList = (values, fallback) => {
  if (!Array.isArray(values)) return [...fallback];

  const cleaned = values
    .map((v) => String(v || '').trim())
    .filter(Boolean);

  return cleaned;
};

const toReplyRules = (reply) => {
  if (!reply) return { ...BUILT_IN_REPLY_RULES };

  const seconds = Number(reply.duplicateWindowSeconds);

  return {
    /*
     * An empty prefix list would mean no subject is ever recognised as a
     * reply, silently splitting every conversation. Fall back rather than
     * accept that.
     */
    subjectPrefixes: cleanList(
      reply.subjectPrefixes,
      BUILT_IN_REPLY_RULES.subjectPrefixes
    ).map((p) => p.replace(/:+$/, '').toLowerCase()),
    stripBracketTags: reply.stripBracketTags !== false,
    requireReplyMarkerForSubjectMatch:
      reply.requireReplyMarkerForSubjectMatch !== false,
    duplicateWindowSeconds:
      Number.isFinite(seconds) && seconds >= 0
        ? seconds
        : BUILT_IN_REPLY_RULES.duplicateWindowSeconds,
  };
};

const toInboxRules = (inbox) => {
  if (!inbox) return { ...BUILT_IN_INBOX_RULES };

  return {
    excludedSubjects: cleanList(inbox.excludedSubjects, []),
    excludedSenders: cleanList(inbox.excludedSenders, []),
    internalDomains: cleanList(inbox.internalDomains, []).map((d) =>
      d.toLowerCase()
    ),
  };
};

const toServiceRouting = (services) => {
  if (!services) return { ...BUILT_IN_SERVICE_ROUTING };

  const list = cleanList(services.list, BUILT_IN_SERVICES);

  return {
    /*
     * An empty list would classify every lead as the fallback and collapse
     * all routing onto one template. Fall back rather than accept that.
     */
    list: list.length ? list : [...BUILT_IN_SERVICES],
    fallback:
      String(services.fallback || '').trim() ||
      BUILT_IN_SERVICE_ROUTING.fallback,
  };
};

export const BUILT_IN_RULES = {
  triggers: toTriggerMap(BUILT_IN_TRIGGERS),
  reply: { ...BUILT_IN_REPLY_RULES },
  inbox: { ...BUILT_IN_INBOX_RULES },
  services: { ...BUILT_IN_SERVICE_ROUTING },
};

/* Kept for callers that only need the trigger map. */
export const BUILT_IN_TRIGGER_MAP = BUILT_IN_RULES.triggers;

export const invalidateTriggerDefaults = () => {
  cache = null;
  cachedAt = 0;
};

/*
 * The effective rules: the saved configuration, with the built-in triggers
 * filling in any scenario type the owner has not configured. Never throws
 * — a database problem must not stop mail from being classified, so the
 * built-ins stand in.
 */
export const loadPlatformRules = async ({ force = false } = {}) => {
  const now = Date.now();

  if (!force && cache && now - cachedAt < CACHE_TTL_MS) return cache;

  try {
    const config = await ScenarioTriggerConfigModel.findOne({}).lean();

    cache = {
      triggers: {
        ...BUILT_IN_RULES.triggers,
        ...toTriggerMap(config?.triggers || []),
      },
      reply: toReplyRules(config?.reply),
      inbox: config?.inbox
        ? toInboxRules(config.inbox)
        : { ...BUILT_IN_INBOX_RULES },
      services: toServiceRouting(config?.services),
    };
  } catch (error) {
    console.error(
      '⚠️ Could not load platform rules — using built-ins:',
      error.message
    );
    cache = {
      triggers: { ...BUILT_IN_RULES.triggers },
      reply: { ...BUILT_IN_REPLY_RULES },
      inbox: { ...BUILT_IN_INBOX_RULES },
      services: { ...BUILT_IN_SERVICE_ROUTING },
    };
  }

  cachedAt = now;
  return cache;
};

/*
 * The last loaded snapshot, for synchronous helpers. See the note at the
 * top of this file on why this is safe.
 */
export const getCachedRules = () => cache || BUILT_IN_RULES;

/* The trigger for one scenario type, or null when none is active. */
export const triggerForType = (rules, scenarioType) => {
  const key = String(scenarioType || '').trim().toLowerCase();
  const trigger = rules?.triggers?.[key];

  if (!trigger || !trigger.enabled || !trigger.subjectFilter) return null;

  return trigger;
};

const escapeRegex = (value = '') =>
  String(value).replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');

/*
 * Builds the "strip reply/forward prefixes" pattern from the configured
 * list. Prefixes stack ("Re: Fwd: Re: ...") and may carry a counter
 * ("Re[2]:"), so the group repeats.
 */
export const subjectPrefixPattern = (replyRules) => {
  const prefixes = replyRules?.subjectPrefixes?.length
    ? replyRules.subjectPrefixes
    : BUILT_IN_REPLY_RULES.subjectPrefixes;

  const alternation = prefixes.map(escapeRegex).join('|');
  const bracketTag = replyRules?.stripBracketTags === false
    ? ''
    : '|\\[[^\\]]{1,30}\\]\\s*';

  return new RegExp(`^((${alternation})\\s*(\\[\\d+\\])?:\\s*${bracketTag})+`, 'i');
};

/* Does this subject carry a reply/forward marker? */
export const hasReplyMarker = (subject, replyRules) => {
  const prefixes = replyRules?.subjectPrefixes?.length
    ? replyRules.subjectPrefixes
    : BUILT_IN_REPLY_RULES.subjectPrefixes;

  const alternation = prefixes.map(escapeRegex).join('|');

  return new RegExp(`^((${alternation})\\s*(\\[\\d+\\])?:\\s*)`, 'i').test(
    String(subject || '').trim()
  );
};

/*
 * Which service is this lead asking about?
 *
 * Searches the subject and body for each configured service in order and
 * returns the first hit — the same first-match-wins rule the router has
 * always used — or the configured fallback.
 */
export const matchService = (text, serviceRules) => {
  const rules = serviceRules || BUILT_IN_SERVICE_ROUTING;
  const haystack = String(text || '').toLowerCase();

  const found = (rules.list || []).find((service) =>
    haystack.includes(String(service).toLowerCase())
  );

  return found || rules.fallback || 'General';
};

/* Is this address one of ours rather than a lead's? */
export const isInternalAddress = (address, inboxRules) => {
  const domains = inboxRules?.internalDomains || [];
  const value = String(address || '').toLowerCase();

  if (!value) return false;

  return domains.some((domain) => value.includes(domain));
};

/* Should this message be kept out of the Lead Inbox entirely? */
export const isExcludedFromInbox = (email, inboxRules) => {
  const subject = String(email?.subject || '').trim().toLowerCase();
  const sender = String(email?.senderAddress || '').trim().toLowerCase();

  const excludedSubjects = inboxRules?.excludedSubjects || [];
  const excludedSenders = inboxRules?.excludedSenders || [];

  if (
    subject &&
    excludedSubjects.some((pattern) =>
      subject.startsWith(String(pattern).trim().toLowerCase())
    )
  ) {
    return true;
  }

  if (
    sender &&
    excludedSenders.some((pattern) =>
      sender.includes(String(pattern).trim().toLowerCase())
    )
  ) {
    return true;
  }

  return false;
};
