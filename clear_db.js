import mongoose from 'mongoose';

const clearDatabase = async () => {
  try {
    const mongoUri = "mongodb+srv://email-sync:email123@cluster0.3ufwdcd.mongodb.net/";
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
