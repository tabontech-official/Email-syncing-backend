import { z } from 'zod';
import mongoose from 'mongoose';

import { scenarioModel } from '../Models/Scenario.js';
import { ConnectionModel } from '../Models/Connection.js';
import { EmailModel } from '../Models/Email.js';
import { TemplateModel } from '../Models/Template.js';
import { ScenarioRunLogModel } from '../Models/ScenarioRunLog.js';
import { authModel } from '../Models/auth.js';
import { evaluateStoredScenarioActivation } from '../utils/scenarioActivation.js';
import { loadPlatformRules } from '../utils/platformScenarioConfig.js';

/*
|--------------------------------------------------------------------------
| MCP tools — what a connected model can see and do
|--------------------------------------------------------------------------
|
| Every tool is defined once here and served over both transports (HTTP
| for remote clients like ChatGPT and Claude connectors, stdio for local
| ones). Splitting them per transport would let the two drift.
|
| SCOPING
|
| Handlers receive the authenticated account and query by its id. A tool
| never reads a userId from its own arguments, so a model cannot be talked
| into fetching another account's mail by an instruction hidden in a lead.
|
| READ VS WRITE
|
| Tools that change something are marked `write: true` and are refused for
| a read-scoped token. The model is not asked to respect that — the server
| enforces it before the handler runs.
|
| RETURN SHAPE
|
| Handlers return plain objects. The server wraps them as JSON text
| content, and also as structuredContent where a client can use it.
| Bodies are truncated: an LLM does not need a 40KB HTML email, and
| sending one wastes the context it does need.
*/

/* Long text costs context and rarely earns it. */
const truncate = (value, max = 2000) => {
  const text = String(value || '');
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n…[truncated, ${text.length - max} more characters]`;
};

const asObjectId = (value) =>
  mongoose.Types.ObjectId.isValid(String(value))
    ? new mongoose.Types.ObjectId(String(value))
    : null;

/* A connection is usable only when the server would accept it. */
const connectionHealth = (connection) => {
  const usable = !connection.status || connection.status === 'active';

  return {
    id: String(connection._id),
    email: connection.email,
    provider: connection.provider,
    status: connection.status || 'active',
    usable,
    needsReconnect: connection.status === 'reauth_required',
    lastError: connection.lastConnectionError || null,
    lastConnected: connection.lastConnected || null,
  };
};

const summariseScenario = (scenario, activation) => ({
  id: String(scenario._id),
  name: scenario.name,
  description: scenario.description,
  type: scenario.type,
  active: Boolean(scenario.scenarioActive),
  /*
   * The distinction the dashboard makes: a scenario switched off on
   * purpose is not the same as one the server refuses to run.
   */
  canActivate: activation ? activation.allowed : undefined,
  blockedBy: activation && !activation.allowed
    ? activation.blockers.map((b) => b.message)
    : [],
  trigger: {
    app: scenario.incomingLead?.app?.name || null,
    subjectFilter: scenario.incomingLead?.subjectFilter || '(platform default)',
    enabled: Boolean(scenario.incomingLead?.enabled),
  },
  steps: (scenario.routerBranches || []).flatMap((branch) =>
    (branch.modules || []).map((m) => ({
      name: m.app?.name || m.type,
      type: m.type,
      replyMode: m.replyMode || 'manual',
      delay:
        m.delayValue != null ? `${m.delayValue} ${m.delayUnit || ''}`.trim() : null,
    }))
  ),
  updatedAt: scenario.updatedAt,
});

const summariseLead = (email) => ({
  id: String(email._id),
  subject: email.subject,
  from: email.senderAddress,
  to: email.recipientAddress,
  service: email.service || null,
  status: email.leadStatus || null,
  direction: email.direction || null,
  receivedAt: email.date || email.createdAt,
  scenarioExecuted: Boolean(email.scenarioExecuted),
  preview: truncate(email.textBody, 300),
});

/*
|--------------------------------------------------------------------------
| Tool definitions
|--------------------------------------------------------------------------
*/
export const TOOLS = [
  {
    name: 'get_account_overview',
    title: 'Account overview',
    description:
      'Plan, usage and a health summary for the connected Replex Engine account: how many scenarios exist, how many are running, and whether any connected mailbox needs attention. Start here to orient yourself.',
    inputSchema: {},
    handler: async ({ user }) => {
      const [scenarios, connections, account] = await Promise.all([
        scenarioModel.find({ userId: user._id }).lean(),
        ConnectionModel.find({ userId: user._id }).lean(),
        authModel.findById(user._id).select('email fullName subscription').lean(),
      ]);

      const health = connections.map(connectionHealth);

      return {
        account: {
          email: account?.email,
          name: account?.fullName,
          plan: account?.subscription?.plan || 'Explore',
        },
        scenarios: {
          total: scenarios.length,
          active: scenarios.filter((s) => s.scenarioActive).length,
          paused: scenarios.filter((s) => !s.scenarioActive).length,
        },
        connections: {
          total: health.length,
          usable: health.filter((c) => c.usable).length,
          needingReconnect: health
            .filter((c) => !c.usable)
            .map((c) => ({ email: c.email, status: c.status })),
        },
      };
    },
  },

  {
    name: 'list_scenarios',
    title: 'List scenarios',
    description:
      'List the automation scenarios on this account with their status. For a paused scenario this also reports whether it CAN be activated, and what is blocking it if not (for example a mailbox whose sign-in has expired).',
    inputSchema: {
      status: z
        .enum(['all', 'active', 'paused'])
        .default('all')
        .describe('Filter by run state.'),
    },
    handler: async ({ user, args }) => {
      const scenarios = await scenarioModel.find({ userId: user._id });

      const filtered = scenarios.filter((s) => {
        if (args.status === 'active') return s.scenarioActive;
        if (args.status === 'paused') return !s.scenarioActive;
        return true;
      });

      const rows = [];
      for (const scenario of filtered) {
        /* Only paused scenarios need the question answered. */
        const activation = scenario.scenarioActive
          ? null
          : await evaluateStoredScenarioActivation(scenario);

        rows.push(summariseScenario(scenario, activation));
      }

      return { count: rows.length, scenarios: rows };
    },
  },

  {
    name: 'get_scenario',
    title: 'Get scenario',
    description:
      'Full configuration of one scenario: its trigger, every step in order, and — when it is not running — exactly why it cannot be activated.',
    inputSchema: {
      scenarioId: z.string().describe('The scenario id.'),
    },
    handler: async ({ user, args }) => {
      const id = asObjectId(args.scenarioId);
      if (!id) return { error: 'That is not a valid scenario id.' };

      const scenario = await scenarioModel.findOne({
        _id: id,
        userId: user._id,
      });

      if (!scenario) return { error: 'No such scenario on this account.' };

      const activation = await evaluateStoredScenarioActivation(scenario);

      return {
        ...summariseScenario(scenario, activation),
        blockers: activation.blockers,
      };
    },
  },

  {
    name: 'set_scenario_active',
    title: 'Activate or pause a scenario',
    description:
      'Switch a scenario on or off. Activation is refused — with reasons — when a mailbox it depends on is unusable or the plan has no room for another active scenario. Pausing always succeeds.',
    write: true,
    inputSchema: {
      scenarioId: z.string().describe('The scenario id.'),
      active: z.boolean().describe('true to activate, false to pause.'),
    },
    handler: async ({ user, args }) => {
      const id = asObjectId(args.scenarioId);
      if (!id) return { error: 'That is not a valid scenario id.' };

      const scenario = await scenarioModel.findOne({
        _id: id,
        userId: user._id,
      });

      if (!scenario) return { error: 'No such scenario on this account.' };

      if (!args.active) {
        scenario.scenarioActive = false;
        await scenario.save();
        return { ok: true, active: false, message: `"${scenario.name}" is paused.` };
      }

      /* The same rule the builder and the dashboard are held to. */
      const activation = await evaluateStoredScenarioActivation(scenario);

      if (!activation.allowed) {
        return {
          ok: false,
          active: scenario.scenarioActive,
          message: 'This scenario cannot be activated yet.',
          blockers: activation.blockers.map((b) => b.message),
        };
      }

      scenario.scenarioActive = true;
      await scenario.save();

      return { ok: true, active: true, message: `"${scenario.name}" is running.` };
    },
  },

  {
    name: 'list_connections',
    title: 'List mailbox connections',
    description:
      'Every mailbox connected to this account and whether it still works. A connection with status "reauth_required" has had its sign-in revoked and must be reconnected by hand — scenarios using it will not send.',
    inputSchema: {},
    handler: async ({ user }) => {
      const connections = await ConnectionModel.find({ userId: user._id })
        .select('_id email provider status lastConnectionError lastConnected')
        .lean();

      return {
        count: connections.length,
        connections: connections.map(connectionHealth),
      };
    },
  },

  {
    name: 'list_leads',
    title: 'List leads',
    description:
      'Recent lead inquiries received by this account, newest first. Use `query` to search subject and sender, and `service` to narrow to one category.',
    inputSchema: {
      query: z.string().optional().describe('Free text matched against subject and sender.'),
      service: z.string().optional().describe('Service category, e.g. "SEO".'),
      limit: z.number().int().min(1).max(100).default(25),
    },
    handler: async ({ user, args }) => {
      const filter = { userId: user._id, isDeleted: { $ne: true } };

      if (args.service) filter.service = args.service;

      if (args.query) {
        /* Escaped: a lead's own text must not become a regex. */
        const safe = args.query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const rx = new RegExp(safe, 'i');
        filter.$or = [{ subject: rx }, { senderAddress: rx }];
      }

      const leads = await EmailModel
        .find(filter)
        .sort({ date: -1, createdAt: -1 })
        .limit(args.limit)
        .lean();

      return { count: leads.length, leads: leads.map(summariseLead) };
    },
  },

  {
    name: 'get_lead',
    title: 'Get lead',
    description:
      'The full record of one lead, including its message body and which scenario handled it.',
    inputSchema: {
      leadId: z.string().describe('The lead id.'),
    },
    handler: async ({ user, args }) => {
      const id = asObjectId(args.leadId);
      if (!id) return { error: 'That is not a valid lead id.' };

      const lead = await EmailModel.findOne({ _id: id, userId: user._id }).lean();
      if (!lead) return { error: 'No such lead on this account.' };

      return {
        ...summariseLead(lead),
        body: truncate(lead.textBody, 8000),
        cc: lead.cc || [],
        matchedScenarioId: lead.matchedScenarioId
          ? String(lead.matchedScenarioId)
          : null,
        provider: lead.provider || null,
      };
    },
  },

  {
    name: 'list_templates',
    title: 'List reply templates',
    description:
      'Reply templates on this account, optionally filtered to one service category.',
    inputSchema: {
      service: z.string().optional().describe('Service category, e.g. "General".'),
      limit: z.number().int().min(1).max(100).default(25),
    },
    handler: async ({ user, args }) => {
      const filter = { userId: user._id };
      if (args.service) filter.service = args.service;

      const templates = await TemplateModel.find(filter).limit(args.limit).lean();

      return {
        count: templates.length,
        templates: templates.map((t) => ({
          id: String(t._id),
          name: t.name || null,
          service: t.service || null,
          platform: t.platform || null,
          active: Boolean(t.active),
          aiResponse: Boolean(t.aiResponse),
          content: truncate(t.content, 1200),
        })),
      };
    },
  },

  {
    name: 'list_scenario_runs',
    title: 'Recent scenario runs',
    description:
      'Execution history — what each scenario did, when, and whether it succeeded. The place to look when a lead did not get a reply.',
    inputSchema: {
      scenarioId: z.string().optional().describe('Limit to one scenario.'),
      limit: z.number().int().min(1).max(100).default(20),
    },
    handler: async ({ user, args }) => {
      const filter = { userId: user._id };

      if (args.scenarioId) {
        const id = asObjectId(args.scenarioId);
        if (!id) return { error: 'That is not a valid scenario id.' };
        filter.scenarioId = id;
      }

      const runs = await ScenarioRunLogModel.find(filter)
        .sort({ createdAt: -1 })
        .limit(args.limit)
        .lean();

      return {
        count: runs.length,
        runs: runs.map((r) => ({
          id: String(r._id),
          scenarioId: r.scenarioId ? String(r.scenarioId) : null,
          scenarioName: r.scenarioName || null,
          scenarioType: r.scenarioType || null,
          runType: r.runType || null,
          status: r.status || null,
          service: r.service || null,
          customerName: r.customerName || null,
          businessEmail: r.businessEmail || null,
          startedAt: r.startedAt || r.createdAt,
          completedAt: r.completedAt || null,
          message: truncate(r.message, 500),
          steps: (r.steps || []).map((st) => ({
            name: st.stepName,
            status: st.status,
            issue: st.issue || null,
          })),
        })),
      };
    },
  },

  {
    name: 'get_platform_trigger_rules',
    title: 'Platform trigger rules',
    description:
      'The subject filters that classify an incoming email as a lead, and the service routing list used to pick a reply template.',
    inputSchema: {},
    handler: async () => {
      const rules = await loadPlatformRules();

      return {
        triggers: Object.values(rules.triggers),
        services: rules.services,
      };
    },
  },
];

/*
|--------------------------------------------------------------------------
| ChatGPT connector compatibility
|--------------------------------------------------------------------------
|
| ChatGPT's connector expects two specific tools — `search`, returning a
| list of {id, title, url}, and `fetch`, returning one document by that
| id. Without them the connector loads but cannot be used in the deep
| research flow.
|
| They are a thin façade over the tools above rather than a second data
| path, so anything reachable one way is reachable the other.
*/
const SEARCHABLE = [
  {
    kind: 'scenario',
    find: async (user, rx, limit) =>
      (await scenarioModel
        .find({ userId: user._id, ...(rx ? { name: rx } : {}) })
        .limit(limit)
        .lean()
      ).map((s) => ({ id: `scenario:${s._id}`, title: s.name || 'Untitled scenario' })),
  },
  {
    kind: 'lead',
    find: async (user, rx, limit) =>
      (await EmailModel
        .find({
          userId: user._id,
          isDeleted: { $ne: true },
          ...(rx ? { $or: [{ subject: rx }, { senderAddress: rx }] } : {}),
        })
        .sort({ date: -1 })
        .limit(limit)
        .lean()
      ).map((e) => ({
        id: `lead:${e._id}`,
        title: e.subject || `Lead from ${e.senderAddress || 'unknown'}`,
      })),
  },
  {
    kind: 'template',
    find: async (user, rx, limit) =>
      (await TemplateModel
        .find({
          userId: user._id,
          ...(rx ? { $or: [{ name: rx }, { service: rx }] } : {}),
        })
        .limit(limit)
        .lean()
      ).map((t) => ({
        id: `template:${t._id}`,
        title: t.name || `${t.service || 'Untitled'} template`,
      })),
  },
];

TOOLS.push({
  name: 'search',
  title: 'Search Replex Engine',
  description:
    'Search across scenarios, leads and templates on this account. Returns matching records as ids that `fetch` can retrieve.',
  inputSchema: {
    query: z.string().describe('What to look for.'),
  },
  handler: async ({ user, args }) => {
    const safe = String(args.query || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const rx = safe ? new RegExp(safe, 'i') : null;

    const groups = await Promise.all(
      SEARCHABLE.map((s) => s.find(user, rx, 10).catch(() => []))
    );

    return { results: groups.flat() };
  },
});

TOOLS.push({
  name: 'fetch',
  title: 'Fetch a Replex Engine record',
  description:
    'Retrieve one record returned by `search`, using its prefixed id (for example "lead:66f…").',
  inputSchema: {
    id: z.string().describe('A prefixed id from search, e.g. "scenario:<id>".'),
  },
  handler: async ({ user, args }) => {
    const [kind, rawId] = String(args.id || '').split(':');
    const id = asObjectId(rawId);

    if (!kind || !id) {
      return { error: 'Expected an id of the form "scenario:<id>", "lead:<id>" or "template:<id>".' };
    }

    if (kind === 'scenario') {
      const scenario = await scenarioModel.findOne({ _id: id, userId: user._id });
      if (!scenario) return { error: 'No such scenario on this account.' };
      const activation = await evaluateStoredScenarioActivation(scenario);
      return summariseScenario(scenario, activation);
    }

    if (kind === 'lead') {
      const lead = await EmailModel.findOne({ _id: id, userId: user._id }).lean();
      if (!lead) return { error: 'No such lead on this account.' };
      return { ...summariseLead(lead), body: truncate(lead.textBody, 8000) };
    }

    if (kind === 'template') {
      const t = await TemplateModel.findOne({ _id: id, userId: user._id }).lean();
      if (!t) return { error: 'No such template on this account.' };
      return {
        id: String(t._id),
        name: t.name || null,
        service: t.service || null,
        platform: t.platform || null,
        active: Boolean(t.active),
        content: truncate(t.content, 8000),
      };
    }

    return { error: `Unknown record type "${kind}".` };
  },
});

export const findTool = (name) => TOOLS.find((t) => t.name === name);
