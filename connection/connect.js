import chalk from 'chalk';
import dotenv from 'dotenv';
import mongoose from 'mongoose';

dotenv.config();

const { cyan, yellow, red } = chalk;

if (!global._mongooseConnection) {
  global._mongooseConnection = { isConnected: false };
}

const Connect = async () => {
  if (global._mongooseConnection.isConnected) {
    console.log(cyan('✅ Using existing MongoDB connection.'));
    return;
  }

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
  }
};

export default Connect;
