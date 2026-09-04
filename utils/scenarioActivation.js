import mongoose from 'mongoose';
import { ConnectionModel } from '../Models/Connection.js';
import { scenarioModel } from '../Models/Scenario.js';
import { authModel } from '../Models/auth.js';

/*
|--------------------------------------------------------------------------
| Scenario activation — the single rule for "may this run?"
|--------------------------------------------------------------------------
|
| A scenario may only be active when every mailbox it depends on still
| works and the owner's plan has room for another active scenario. That
| decision is made when a scenario is saved (controller/Scenario.js) and
| again when something else asks to switch one on — the MCP connector, for
| instance.
|
| It lives here so those callers cannot drift apart. A second copy of this
| rule is precisely how the UI came to show a scenario as running while
| the server had stored it as off: two implementations of "working
| mailbox", disagreeing.
|
| Every refusal is returned as a blocker carrying a human-readable
| message, so whatever is asking can say WHY rather than reporting a bare
| false.
*/

/* Mirrors the module classification used when a scenario is saved. */
const isDelayModule = (module) => {
  const appName =
    typeof module?.app?.name === 'string' ? module.app.name.toLowerCase() : '';
  const type = typeof module?.type === 'string' ? module.type.toLowerCase() : '';

  return appName.includes('delay') || type.includes('delay');
};

const isEmailModule = (module) => {
  if (isDelayModule(module)) return false;

  const appName =
    typeof module?.app?.name === 'string' ? module.app.name.toLowerCase() : '';
  const type = typeof module?.type === 'string' ? module.type.toLowerCase() : '';

  return (
    appName.includes('email') ||
    appName.includes('gmail') ||
    appName.includes('follow') ||
    appName.includes('initial') ||
    type.includes('email') ||
    type.includes('gmail')
  );
};

const normalizeId = (value) => {
  const raw = Array.isArray(value) ? value[0] : value;

  if (typeof raw === 'string') return raw.trim();
  return raw?.toString?.().trim() || '';
};

/*
 * Which connections a scenario needs, and what each one is for.
 *
 * Takes the already-normalised trigger and branches so it can be used
 * both on a payload being saved and on a stored document.
 */
export const collectRequiredConnections = ({
  incomingConnectionId = '',
  isMailhookTrigger = false,
  incomingLeadConfigured = false,
  routerBranches = [],
} = {}) => {
  const required = [];

  if (incomingLeadConfigured && !isMailhookTrigger) {
    required.push({ id: incomingConnectionId, role: 'trigger inbox' });
  }

  (Array.isArray(routerBranches) ? routerBranches : []).forEach((branch) => {
    const modules = Array.isArray(branch?.modules) ? branch.modules : [];

    modules.forEach((module) => {
      if (!isEmailModule(module)) return;

      required.push({
        id: normalizeId(module.connectionId),
        role: module.app?.name || module.type || 'an email step',
      });
    });
  });

  return required;
};

/*
 * Check the required connections and describe anything wrong with them.
 *
 * Connections are fetched WITHOUT filtering on status, so a rejected one
 * can be named. A row predating the status field counts as active — that
 * is the schema default, and it is what the connections API reports for
 * it.
 */
export const evaluateConnectionBlockers = async (required = []) => {
  const blockers = [];
  const roles = new Map();
  const ids = [];

  required.forEach(({ id, role }) => {
    if (!id) {
      blockers.push({
        code: role === 'trigger inbox' ? 'inbox_missing' : 'sender_missing',
        role,
        message:
          role === 'trigger inbox'
            ? 'No inbox is connected for the trigger.'
            : `"${role}" has no sending account selected.`,
      });
      return;
    }

    ids.push(id);

    const existing = roles.get(id);
    if (!existing) roles.set(id, role);
    else if (!existing.includes(role)) roles.set(id, `${existing}, ${role}`);
  });

  const unique = [...new Set(ids)];

  const wellFormed = unique.filter((id) => mongoose.Types.ObjectId.isValid(id));

  unique
    .filter((id) => !mongoose.Types.ObjectId.isValid(id))
    .forEach((id) => {
      const role = roles.get(id) || 'a step';
      blockers.push({
        code: 'connection_invalid',
        role,
        connectionId: id,
        message: `The account selected for ${role} is not a valid connection.`,
      });
    });

  if (wellFormed.length === 0) return blockers;

  const found = await ConnectionModel.find({
    _id: { $in: wellFormed },
  }).select('_id email provider status lastConnectionError');

  const byId = new Map(found.map((c) => [c._id.toString(), c]));

  wellFormed.forEach((id) => {
    const role = roles.get(id) || 'a step';
    const connection = byId.get(id);

    if (!connection) {
      blockers.push({
        code: 'connection_missing',
        role,
        connectionId: id,
        message: `The account selected for ${role} no longer exists. Choose another one.`,
      });
      return;
    }

    if (!connection.status || connection.status === 'active') return;

    const label = connection.email || 'this account';
    const reauth = connection.status === 'reauth_required';

    blockers.push({
      code: reauth ? 'reauth_required' : 'connection_disconnected',
      role,
      connectionId: id,
      email: connection.email || '',
      provider: connection.provider || '',
      status: connection.status,
      message: reauth
        ? `${label} needs to be reconnected — its sign-in has expired. Reconnect it to activate this scenario.`
        : `${label} is disconnected. Reconnect it to activate this scenario.`,
    });
  });

  return blockers;
};

/* How many scenarios this plan may run at once. */
export const activeScenarioLimit = (user) => {
  const plan = (user?.subscription?.plan || 'Explore').toLowerCase();

  let limit =
    user?.subscription?.scenariosLimit ||
    (plan === 'elevate'
      ? 5
      : plan === 'unite'
        ? 15
        : plan === 'enterprise'
          ? 999
          : 1);

  if (user?.subscription?.extraScenariosLimit) {
    limit += user.subscription.extraScenariosLimit;
  }

  return limit;
};

/*
 * Whether the plan has room for one more active scenario, ignoring the
 * one being switched on. Returns a blocker or null.
 */
export const evaluatePlanLimitBlocker = async (userId, scenarioId) => {
  if (!userId) return null;

  const user = await authModel.findById(userId);
  const maxActive = activeScenarioLimit(user);

  const otherActiveCount = await scenarioModel.countDocuments({
    userId,
    ...(scenarioId ? { _id: { $ne: scenarioId } } : {}),
    scenarioActive: true,
  });

  if (otherActiveCount < maxActive) return null;

  return {
    code: 'active_limit_reached',
    role: 'plan limit',
    limit: maxActive,
    plan: user?.subscription?.plan || 'Explore',
    message: `Your plan allows ${maxActive} active scenario${
      maxActive === 1 ? '' : 's'
    }. Pause another scenario or upgrade to activate this one.`,
  };
};

/*
 * The whole question answered for a STORED scenario: may this be switched
 * on right now, and if not, why not. Used by callers that act on a saved
 * document rather than a payload being written.
 */
export const evaluateStoredScenarioActivation = async (scenario) => {
  if (!scenario) return { allowed: false, blockers: [] };

  const incoming = scenario.incomingLead || {};
  const isMailhookTrigger =
    (incoming.app?.name || '').toLowerCase() === 'mailhook';

  const incomingConnectionId = normalizeId(incoming.connectionId);

  const incomingLeadConfigured = Boolean(
    incoming.enabled ||
      incomingConnectionId ||
      normalizeId(incoming.mailhookId) ||
      incoming.subjectFilter
  );

  const blockers = await evaluateConnectionBlockers(
    collectRequiredConnections({
      incomingConnectionId,
      isMailhookTrigger,
      incomingLeadConfigured,
      routerBranches: scenario.routerBranches,
    })
  );

  const planBlocker = await evaluatePlanLimitBlocker(
    scenario.userId,
    scenario._id
  );

  if (planBlocker) blockers.push(planBlocker);

  return { allowed: blockers.length === 0, blockers };
};
