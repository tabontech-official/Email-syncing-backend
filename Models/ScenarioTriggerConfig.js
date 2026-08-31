import mongoose from 'mongoose';

/*
|--------------------------------------------------------------------------
| Platform scenario / reply / inbox rules (singleton)
|--------------------------------------------------------------------------
|
| Every account is created with a built-in Shopify scenario, and the rules
| that decide what counts as a lead, what counts as a reply to one, and
| what the Lead Inbox hides were spread across the codebase as literals:
| the Partner Directory subject in three places, the "Re:/Fwd:" prefix list
| in four, the onboarding subject in two, and our own domains in two more.
| Any change to Shopify's notification subject — or adding a support domain
| — meant a deploy.
|
| This holds all of it so the platform owner can change it from the master
| admin panel. One document for the whole platform, addressed findOne({}).
|
| A user's own scenario still wins where the two overlap: a subject filter
| saved on a scenario is what that scenario triggers on. These are the
| defaults applied to built-in scenarios and the platform-wide policies
| that have no per-user equivalent.
*/

const triggerSchema = new mongoose.Schema(
  {
    /* The scenario `type` this default applies to — matches Scenario.type. */
    scenarioType: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },

    label: {
      type: String,
      default: '',
      trim: true,
    },

    /*
     * Compared against the message subject with reply/forward prefixes
     * ("Re:", "Fwd:", "[External]") already stripped, so a reply is
     * measured against the same subject its original was.
     */
    subjectFilter: {
      type: String,
      default: '',
      trim: true,
    },

    /*
     * 'contains' catches leads whose subject is prefixed by a mail
     * gateway; 'startsWith' is stricter and matches only messages that
     * open with the filter.
     */
    matchMode: {
      type: String,
      enum: ['contains', 'startsWith'],
      default: 'contains',
    },

    /*
     * A disabled trigger stops classifying mail. Scenarios of this type
     * then fall back to their own saved subject filter, and match nothing
     * when they have none — which keeps unrelated mail out of the Lead
     * Inbox rather than letting all of it in.
     */
    enabled: {
      type: Boolean,
      default: true,
    },
  },
  { _id: false }
);

/*
 * How an incoming message is recognised as a reply to an existing lead
 * rather than a new one. Header-based matching (In-Reply-To, References,
 * provider thread id) is RFC-defined and stays in code; these are the
 * heuristics that sit on top of it.
 */
const replyRulesSchema = new mongoose.Schema(
  {
    /*
     * Prefixes stripped before comparing subjects, and — with
     * requireReplyMarkerForSubjectMatch — the markers that identify a
     * message as a reply. Stored without the colon: "re", "fwd", "fw".
     */
    subjectPrefixes: {
      type: [String],
      default: ['re', 'fwd', 'fw', 'aw', 'wg'],
    },

    /*
     * Also strip bracketed gateway tags such as "[External]" or
     * "[SPAM]" before comparing.
     */
    stripBracketTags: {
      type: Boolean,
      default: true,
    },

    /*
     * Subject matching is the last resort in reply resolution and the
     * only one that can attach the wrong message. Leaving this on means
     * it is attempted only when the message actually looks like a reply
     * (a prefix or an In-Reply-To header). Turning it off catches
     * clients that strip both, at the risk of merging conversations that
     * merely share a subject.
     */
    requireReplyMarkerForSubjectMatch: {
      type: Boolean,
      default: true,
    },

    /*
     * Providers can deliver the same message twice (an IDLE event and a
     * webhook). Two messages from one sender with identical opening text
     * inside this window are treated as one.
     */
    duplicateWindowSeconds: {
      type: Number,
      default: 10,
      min: 0,
      max: 600,
    },
  },
  { _id: false }
);

/*
 * What the Lead Inbox hides, and how it tells our own addresses from a
 * lead's. Separate from the scenario criteria: these apply to every user
 * regardless of which scenarios they run.
 */
const inboxRulesSchema = new mongoose.Schema(
  {
    /*
     * Threads whose subject starts with one of these never reach the Lead
     * Inbox. Holds the onboarding mail the platform sends itself, which
     * is not a lead and would otherwise sit at the top of every new
     * account's inbox.
     */
    excludedSubjects: {
      type: [String],
      default: ['Welcome to Replex Engine'],
    },

    /* Senders whose mail never reaches the Lead Inbox (substring match). */
    excludedSenders: {
      type: [String],
      default: [],
    },

    /*
     * Our own sending domains. A message from one of these is us, not the
     * lead, so the thread is keyed by the other party's address. Get this
     * wrong and replies split into separate threads.
     */
    internalDomains: {
      type: [String],
      default: [
        'replexengine.com',
        'mail.replexengine.com',
        'shopifyexpertsteam.com',
        '2014tabontech',
      ],
    },
  },
  { _id: false }
);

/*
 * The router's SECOND condition: which service a lead is asking about.
 *
 * The trigger subject decides whether a message is a lead at all; this
 * decides which reply it gets. The matched service selects the template
 * (`service` + step name), so the list is what routes a lead to
 * "Troubleshooting - Initial Email" rather than "SEO - Initial Email".
 */
const serviceRoutingSchema = new mongoose.Schema(
  {
    /*
     * ORDER IS SIGNIFICANT. The subject and body are searched for each
     * entry in turn and the FIRST one found wins, so a broad term placed
     * above a specific one will shadow it — "General" first means any
     * message containing that word never reaches "SEO".
     */
    list: {
      type: [String],
      default: [],
    },

    /* Used when a lead mentions no service at all. */
    fallback: {
      type: String,
      default: 'General',
      trim: true,
    },
  },
  { _id: false }
);

const scenarioTriggerConfigSchema = new mongoose.Schema(
  {
    triggers: {
      type: [triggerSchema],
      default: [],
    },

    reply: {
      type: replyRulesSchema,
      default: () => ({}),
    },

    inbox: {
      type: inboxRulesSchema,
      default: () => ({}),
    },

    services: {
      type: serviceRoutingSchema,
      default: () => ({}),
    },

    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  { timestamps: true }
);

export const ScenarioTriggerConfigModel =
  mongoose.models.ScenarioTriggerConfig ||
  mongoose.model('ScenarioTriggerConfig', scenarioTriggerConfigSchema);
