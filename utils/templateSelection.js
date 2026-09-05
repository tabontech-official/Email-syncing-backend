/*
|--------------------------------------------------------------------------
| Which template answers this lead — one definition
|--------------------------------------------------------------------------
|
| WHY THIS EXISTS
|
| "Is the right template active for this service?" was implemented three
| times, in three places, by hand:
|
|   - controller/smtpServer.js, the immediate Send an Email module — the
|     one that actually mails the customer.
|   - controller/smtpServer.js, the delayed follow-up module.
|   - controller/template.js + the Send Test panel, which fetched every
|     template for a service and applied its own predicate to decide
|     whether to warn the user.
|
| They drifted, which is not a surprise; it is what copies do. The Send
| Test gate ended up asking whether EVERY template for the service was
| active, while the engine asked for one — the service's Initial Email.
| Switching on the Initial Email therefore never cleared the warning, and
| the warning said the reply would fall back to General when it was not
| going to. The screen and the engine disagreed about the same account,
| at the same moment, and both were reporting honestly.
|
| So the question is asked once, here. Callers get an answer, not a query
| to reimplement.
|
| WHAT THE RULE IS
|
| A reply uses the template that is
|
|   - owned by this user,
|   - on the 'shopify' platform,
|   - for exactly this service (case-insensitive),
|   - named for the sequence step being sent, and
|   - switched on.
|
| Failing that, the same question is asked of General, which is why
| General cannot be deactivated: it is the floor. Failing that too,
| nothing is sent — a follow-up with no content is not a follow-up.
*/

/* The service every lead falls back to. */
export const GENERAL_SERVICE = 'General';

/* The sequence steps a scenario can send, in order. */
export const STEP_TYPES = ['initial', 'first', 'second'];

/*
 * Anything unrecognised is the initial email.
 *
 * The scenario builder stores a step as a template NAME ("First
 * Follow-up"), the Send Test panel talks in terms of the initial email
 * only, and the API takes whatever a caller sends. One funnel for all
 * three, so a typo cannot silently select a different step's template.
 */
export const normalizeStepType = (value = '') => {
  const text = String(value || '').toLowerCase();

  if (text.includes('second')) return 'second';
  if (text.includes('first')) return 'first';

  return 'initial';
};

/*
 * An exact, case-insensitive match on a service name.
 *
 * Service names are administrator-entered text and reach this unmodified
 * from the inquiry form, so they are escaped before being interpolated
 * into a pattern: "Analytics (GA4)" would otherwise compile to a group
 * and match nothing.
 */
export const exactServiceRegex = (service = '') =>
  new RegExp(
    '^' +
      String(service).replace(/[^A-Za-z0-9 ]/g, (ch) => '\\' + ch) +
      '$',
    'i'
  );

/*
 * The names that count as this step.
 *
 * Both wordings are in the wild: the seeded templates are called
 * "<Service> - Initial Email", and hand-made ones tend to say
 * "Initial Follow-up".
 */
export const stepNameRegex = (stepType) => {
  const step = normalizeStepType(stepType);

  const pattern =
    step === 'initial'
      ? '(.*Initial Email.*|.*Initial Follow-up.*)'
      : step === 'first'
        ? '(.*First Email.*|.*First Follow-up.*)'
        : '(.*Second Email.*|.*Second Follow-up.*)';

  return new RegExp(pattern, 'i');
};

/*
 * The query, exactly as the send path issues it. Exported so a test — or
 * anyone auditing this — can compare two callers' queries directly
 * rather than reading two functions and hoping.
 */
export const activeTemplateQuery = ({ userId, service, stepType }) => ({
  userId,
  platform: 'shopify',
  service: exactServiceRegex(service),
  $or: [{ name: stepNameRegex(stepType) }],
  active: true,
});

/*
 * Which template will answer a lead for this service and step.
 *
 * `TemplateModel` is passed in rather than imported so this module stays
 * free of the model layer and can be exercised with a stub.
 *
 * Returns:
 *   template          the document that will be sent, or null
 *   willUseTemplate   false means nothing is sent for this step
 *   service           the service the template actually came from
 *   requestedService  the service that was asked for
 *   fallbackToGeneral true when the requested service had nothing active
 *                     and General answered in its place
 */
export const resolveActiveTemplate = async (
  TemplateModel,
  { userId, service, stepType }
) => {
  const step = normalizeStepType(stepType);
  const requestedService = String(service || '').trim() || GENERAL_SERVICE;

  const isGeneral =
    requestedService.toLowerCase() === GENERAL_SERVICE.toLowerCase();

  let template = await TemplateModel.findOne(
    activeTemplateQuery({ userId, service: requestedService, stepType: step })
  );

  let fallbackToGeneral = false;

  /*
   * Only a genuine fallback runs a second query. Asking General twice
   * when General is what was requested is the same answer at twice the
   * cost, and it made the logs read as though a fallback had happened.
   */
  if (!template && !isGeneral) {
    template = await TemplateModel.findOne(
      activeTemplateQuery({
        userId,
        service: GENERAL_SERVICE,
        stepType: step,
      })
    );

    fallbackToGeneral = Boolean(template);
  }

  return {
    template: template || null,
    willUseTemplate: Boolean(template),
    stepType: step,
    requestedService,
    service: fallbackToGeneral ? GENERAL_SERVICE : requestedService,
    fallbackToGeneral,
  };
};
