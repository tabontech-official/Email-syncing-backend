import chalk from 'chalk';
import dotenv from 'dotenv';
import mongoose from 'mongoose';

dotenv.config();

const { cyan, yellow, red } = chalk;

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
      serverSelectionTimeoutMS: 10000,
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

export const ensureDbConnected = async () => {
  /* 1 = connected. Nothing to do, and this is the common path. */
  if (mongoose.connection.readyState === 1) return;

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

export default Connect;
