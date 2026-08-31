/*
|--------------------------------------------------------------------------
| Scenario matching — one definition of "this email is a lead"
|--------------------------------------------------------------------------
|
| WHY THIS EXISTS
|
| A connection syncs a whole mailbox, so every newsletter, receipt and
| password reset lands in EmailModel next to the real leads. The Lead
| Inbox was showing all of it.
|
| An email belongs in the Lead Inbox when it meets the criteria of one of
| the user's scenarios — the same criteria executeScenarios() acts on.
| Keeping that judgement in one module means the inbox cannot drift from
| what the automation actually responds to.
|
| Two callers:
|
|   - executeScenarios() stamps matchedScenarioId on arrival, so the
|     verdict is recorded at receive time.
|   - getEmailDataforUser() re-evaluates when building the inbox, so
|     mail that arrived before a scenario existed (or before its filter
|     was edited) is judged by the current rules rather than staying
|     invisible forever.
|
| WHAT IS DELIBERATELY NOT FILTERED
|
| Filtering happens per THREAD, not per message. A thread is kept when any
| message in it matches, so customer replies — "Re:" subjects, threadId /
| conversationId stitching, In-Reply-To chains — travel with the lead they
| belong to and are never hidden on their own.
*/

/*
 * Built-in scenarios (the Shopify one every account starts with) carry no
 * subject filter of their own — the platform owner sets it in the master
 * admin panel. Callers load those rules with loadPlatformRules() and
 * pass them in; see utils/platformScenarioConfig.js.
 *
 * This module stays pure and synchronous so the same call can be made per
 * message on the mail path and per thread when building the inbox.
 */
import {
  getCachedRules,
  subjectPrefixPattern,
  triggerForType,
} from './platformScenarioConfig.js';

/*
 * Reply and forward prefixes stack ("Re: Fwd: Re: ..."), and some
 * gateways prepend a tag. Strip them all so a reply is measured against
 * the same subject its original was.
 *
 * Which prefixes count is set by the platform owner; see
 * utils/platformScenarioConfig.js. Sync on purpose — this is called per
 * message and per thread — so it reads the warm snapshot unless the
 * caller passes rules it already loaded.
 */
export const normalizeSubject = (subject = '', rules = null) => {
  const replyRules = (rules || getCachedRules()).reply;

  return String(subject || '')
    .replace(subjectPrefixPattern(replyRules), '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
};

const stripHtml = (value = '') =>
  String(value || '').replace(/<[^>]*>/g, ' ');

const emailFields = (email = {}, rules = null) => ({
  subject: normalizeSubject(email.subject, rules),
  body: (email.textBody || stripHtml(email.htmlBody) || '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase(),
  from: String(email.senderAddress || email.from || '')
    .trim()
    .toLowerCase(),
});

/*
 * Mirrors the condition evaluation in executeScenarios(): unknown fields
 * and unknown operators do not match, and a condition set must be
 * satisfied in full.
 */
const conditionsMatch = (conditions, fields) =>
  conditions.every((cond) => {
    const field = String(cond?.field || '').toLowerCase();

    const fieldValue =
      field === 'subject'
        ? fields.subject
        : field === 'body'
          ? fields.body
          : field === 'from'
            ? fields.from
            : null;

    if (fieldValue === null) return false;

    const condValue = String(cond?.value || '').trim().toLowerCase();
    if (!condValue) return false;

    const operator = String(cond?.operator || '').toLowerCase();

    if (operator === 'contains') return fieldValue.includes(condValue);
    if (operator === 'equals' || operator === 'equal to')
      return fieldValue === condValue;

    return false;
  });

const branchConditionSets = (scenario) =>
  (scenario?.routerBranches || [])
    .map((branch) => branch?.filter?.conditions)
    .filter((conditions) => Array.isArray(conditions) && conditions.length > 0);

/*
 * The criteria a scenario screens incoming mail with, or null when it has
 * none configured yet. A scenario with no criteria cannot classify
 * anything, so it neither includes nor excludes mail.
 */
export const scenarioCriteria = (scenario, rules = null) => {
  const subjectFilter = String(scenario?.incomingLead?.subjectFilter || '')
    .trim()
    .toLowerCase();

  const conditionSets = branchConditionSets(scenario);

  /*
   * A filter saved on the scenario always wins — the user configured it
   * deliberately. The platform default only fills in for a built-in
   * scenario that has never been customised.
   */
  if (subjectFilter) {
    return {
      subjectFilter,
      matchMode: 'contains',
      conditionSets,
    };
  }

  const platformTrigger = triggerForType(rules, scenario?.type);

  if (platformTrigger) {
    return {
      subjectFilter: platformTrigger.subjectFilter.toLowerCase(),
      matchMode: platformTrigger.matchMode,
      conditionSets,
    };
  }

  if (conditionSets.length === 0) return null;

  return { subjectFilter: '', matchMode: 'contains', conditionSets };
};

export const hasAnyScenarioCriteria = (scenarios = [], rules = null) =>
  scenarios.some((scenario) => scenarioCriteria(scenario, rules) !== null);

/*
 * Does this email meet the scenario's trigger criteria?
 *
 * The subject filter is the trigger the user configures on the Incoming
 * Leads module, so when one is set it decides on its own — branch
 * conditions are routing between replies, not a second gate on whether
 * something is a lead. Only when no subject filter is configured do the
 * branch conditions stand in as the criteria.
 *
 * Matching is `includes` on the prefix-stripped subject, where
 * executeScenarios() uses `startsWith` on the raw one. That is
 * deliberately the looser of the two: showing a lead the automation
 * skipped is recoverable, hiding one it answered is not.
 */
export const scenarioMatchesEmail = (scenario, email, rules = null) => {
  const criteria = scenarioCriteria(scenario, rules);
  if (!criteria) return false;

  const fields = emailFields(email, rules);

  if (criteria.subjectFilter) {
    return criteria.matchMode === 'startsWith'
      ? fields.subject.startsWith(criteria.subjectFilter)
      : fields.subject.includes(criteria.subjectFilter);
  }

  return criteria.conditionSets.some((conditions) =>
    conditionsMatch(conditions, fields)
  );
};

/* The first scenario this email qualifies for, or null. */
export const findMatchingScenario = (scenarios = [], email, rules = null) =>
  scenarios.find((scenario) => scenarioMatchesEmail(scenario, email, rules)) ||
  null;

/* True when any message in a thread qualifies it for the Lead Inbox. */
export const threadMatchesScenarios = (scenarios = [], messages = [], rules = null) =>
  messages.some(
    (message) =>
      message?.matchedScenarioId ||
      findMatchingScenario(scenarios, message, rules) !== null
  );
