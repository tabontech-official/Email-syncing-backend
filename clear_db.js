import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

/*
|--------------------------------------------------------------------------
| DESTRUCTIVE — requires an explicit confirmation flag
|--------------------------------------------------------------------------
|
| This wipes emails, connections and automation statuses for EVERY account,
| unscoped. It used to run the moment the file was executed, so a stray
| `node clear_db.js` destroyed all customer data with no confirmation.
|
| Usage:  node clear_db.js --yes-delete-everything
*/
if (!process.argv.includes('--yes-delete-everything')) {
  console.error('Refusing to run.');
  console.error('This deletes ALL emails, connections and automation statuses for EVERY user.');
  console.error('Re-run with --yes-delete-everything if that is genuinely what you want.');
  process.exit(1);
}

const clearDatabase = async () => {
  try {
    const mongoUri = process.env.DB_URL || process.env.DB_URI;
    if (!mongoUri) {
      console.error('❌ DB_URL or DB_URI is missing in process.env');
      process.exit(1);
    }
    console.log('Connecting to MongoDB...');
    await mongoose.connect(mongoUri);
    console.log('🧹 Clearing DB collections...');
    
    const db = mongoose.connection.db;
    
    const emailRes = await db.collection("emails").deleteMany({});
    const connRes = await db.collection("connections").deleteMany({});
    const statusRes = await db.collection("automationstatuses").deleteMany({});
    
    console.log(`✅ Cleared ${emailRes.deletedCount} Email records.`);
    console.log(`✅ Cleared ${connRes.deletedCount} Connection records.`);
    console.log(`✅ Cleared ${statusRes.deletedCount} AutomationStatus records.`);
    
    process.exit(0);
  } catch (err) {
    console.error('❌ Error clearing DB:', err);
    process.exit(1);
  }
};

clearDatabase();
