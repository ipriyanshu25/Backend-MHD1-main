// scripts/addTypeToEntries.js
const mongoose = require('mongoose');

async function runMigration() {
  try {   
    const Entry = mongoose.model('Entry', new mongoose.Schema({}, { strict: false }), 'entries');

    // 2) Update all docs where "type" field does NOT exist
    const result = await Entry.updateMany(
      { type: { $exists: false } },
      { $set: { type: 3 } }
    );

    console.log(`Matched ${result.matchedCount}, modified ${result.modifiedCount} documents.`);
  } catch (err) {
    console.error('Migration failed:', err);
  } finally {
    await mongoose.disconnect();
    console.log('Disconnected from MongoDB');
  }
}

runMigration();
