import chalk from 'chalk';
import dotenv from 'dotenv';
import mongoose from 'mongoose';

dotenv.config();

const { cyan, yellow, red } = chalk;

/*
 * The ceiling on ONE connection attempt. Shared with the retry loop
 * below, which has to know how long an attempt can take before it can
 * decide whether another one fits in the remaining budget.
 */
const SERVER_SELECTION_TIMEOUT_MS = 4000;

if (!global._mongooseConnection) {
  global._mongooseConnection = { isConnected: false };
}

const Connect = async () => {
  /*
   * The flag alone is not enough: it can say "connected" while the socket
   * has gone. Trusting it on its own makes a retry a no-op that resolves
   * immediately, so a dropped connection could never be re-established.
   * readyState is the authority; the flag is a cache in front of it.
   */
  if (global._mongooseConnection.isConnected && mongoose.connection.readyState === 1) {
    console.log(cyan('✅ Using existing MongoDB connection.'));
    return;
  }

  global._mongooseConnection.isConnected = false;

  const dbUri = process.env.DB_URL || process.env.DB_URI;
  if (!dbUri) {
    console.error(red('❌ DB_URL or DB_URI environment variable is missing. Cannot connect to MongoDB.'));
    throw new Error('DB_URL or DB_URI environment variable is missing.');
  }

  try {
    const conn = await mongoose.connect(dbUri, {
      /*
       * Deliberately shorter than the retry budget in ensureDbConnected,
       * so a slow attempt leaves room for a second one. At 10s a single
       * timeout consumed the whole budget and the retry could never run —
       * which is the case that most needs it.
       *
       * A healthy Atlas selection completes in well under a second; this
       * is a ceiling, not an expected wait.
       */
      serverSelectionTimeoutMS: SERVER_SELECTION_TIMEOUT_MS,
    });

    global._mongooseConnection.isConnected = conn.connections[0].readyState === 1;

    console.log(cyan('✅ MongoDB connected to:'), conn.connection.host);

    mongoose.connection.on('disconnected', () => {
      console.log(red('🔌 MongoDB disconnected'));
      global._mongooseConnection.isConnected = false;
    });

    process.on('SIGINT', async () => {
      await mongoose.connection.close();
      console.log(red('🛑 MongoDB disconnected due to app termination'));
      process.exit(0);
    });

  } catch (err) {
    console.error(yellow('❌ MongoDB connection error:'), err);

    /*
     * Rethrow. Swallowing this made a failed connection indistinguishable
     * from a successful one: `await Connect()` resolved, callers carried
     * on believing they had a database, and the failure only surfaced
     * later as "Operation `users.findOne()` buffering timed out after
     * 10000ms" on whatever request happened to run next.
     */
    throw err;
  }
};

/*
|--------------------------------------------------------------------------
| ensureDbConnected — the connection guard for serverless
|--------------------------------------------------------------------------
|
| On a long-running server the process connects once at boot and that is
| that. A serverless instance is different: it is created to serve a
| request, and the request can arrive before the connection is up, or on
| an instance whose connection attempt failed earlier.
|
| So the connection is established lazily and awaited per request, with
| the in-flight attempt shared — a burst of concurrent requests on a cold
| instance produces one connection, not one per request.
|
| A FAILED attempt is deliberately not cached. Clearing the promise means
| the next request tries again, so an instance that starts life unable to
| reach Atlas recovers on its own. Caching the rejection is what turns a
| momentary blip into an instance that serves errors until it is recycled.
*/
let connectionAttempt = null;

/*
 * Retry inside the request, rather than making the user do it.
 *
 * Clearing the failed attempt let the NEXT request recover, which is
 * right — but it left the current one to fail. On a cold instance that
 * was reliably the user's first action: sign in, get an error, sign in
 * again, get in. The retry belongs here, where it costs a few hundred
 * milliseconds, not on the person.
 *
 * Bounded by wall clock, not just attempt count: a serverless invocation
 * has a hard ceiling, and burning it on connection attempts turns a
 * recoverable 503 into a function timeout with no response at all —
 * which is strictly worse, because the browser cannot report a reason.
 */
const CONNECT_MAX_ATTEMPTS = 3;
const CONNECT_TOTAL_BUDGET_MS = 9000;
const CONNECT_RETRY_PAUSE_MS = 250;

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const attemptConnection = async () => {
  if (!connectionAttempt) {
    connectionAttempt = Connect().catch((err) => {
      connectionAttempt = null;
      throw err;
    });
  }

  await connectionAttempt;

  /*
   * Belt and braces: if the attempt resolved but the socket still is not
   * ready, treat it as a failure rather than letting the caller issue a
   * query that will sit in the buffer for ten seconds.
   */
  if (mongoose.connection.readyState !== 1) {
    connectionAttempt = null;
    throw new Error('MongoDB is not connected.');
  }
};

export const ensureDbConnected = async () => {
  /* 1 = connected. Nothing to do, and this is the common path. */
  if (mongoose.connection.readyState === 1) return;

  const startedAt = Date.now();
  let lastError = null;

  for (let attempt = 1; attempt <= CONNECT_MAX_ATTEMPTS; attempt += 1) {
    try {
      await attemptConnection();
      if (attempt > 1) {
        console.log(cyan(`✅ MongoDB connected on attempt ${attempt}.`));
      }
      return;
    } catch (err) {
      lastError = err;
      connectionAttempt = null;

      const elapsed = Date.now() - startedAt;
      const budgetLeft = CONNECT_TOTAL_BUDGET_MS - elapsed;

      /*
       * Stop if this was the last attempt, or if there is not enough time
       * left for a WHOLE further attempt.
       *
       * Checking only the pause was wrong: with 750ms left it would start
       * an attempt that can run for four seconds, overshooting the budget
       * the check exists to enforce. An attempt costs the pause plus the
       * server-selection ceiling, so that is what must fit.
       */
      const roomForAnother =
        CONNECT_RETRY_PAUSE_MS * attempt + SERVER_SELECTION_TIMEOUT_MS;

      if (attempt === CONNECT_MAX_ATTEMPTS || budgetLeft <= roomForAnother) {
        break;
      }

      console.log(
        yellow(
          `⚠️ MongoDB connect attempt ${attempt} failed (${err?.message}) — retrying.`
        )
      );

      await pause(CONNECT_RETRY_PAUSE_MS * attempt);
    }
  }

  throw lastError || new Error('MongoDB is not connected.');
};

export default Connect;
