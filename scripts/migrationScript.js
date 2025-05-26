const User  = require('../models/User');
const Entry = require('../models/Entry');
const uuid  = require('uuid').v4;

(async () => {
  const users = await User.find({ 'entries.0': { $exists: true } }).lean();
  for (const u of users) {
    for (const e of u.entries) {
      await Entry.create({
        ...e,
        entryId: uuid(),
        type: 1,
        userId: u.userId
      });
    }
  }
  console.log('Migration done');
  process.exit(0);
})();
