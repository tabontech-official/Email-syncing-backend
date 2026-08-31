/*
|--------------------------------------------------------------------------
| Backfill: convert stored mail bodies to text
|--------------------------------------------------------------------------
|
| New mail is sanitised on arrival (see utils/emailBody.js). This applies
| the same treatment to what is already in the database: reduce each
| stored html body to basic semantic markup, and derive a text version
| alongside it.
|
| Dry run by default. Nothing is written without --apply:
|
|   node scripts/shrink_email_bodies.mjs            # report only
|   node scripts/shrink_email_bodies.mjs --apply    # write
|
| Refuses to blank a body it could not derive text for — an email with no
| readable text and no markup left would be unreadable, and a smaller
| database is not worth a lost message.
*/

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { normalizeIncomingBody, bodySavings } from '../utils/emailBody.js';

dotenv.config();

const APPLY = process.argv.includes('--apply');
const BATCH = 200;

const mb = (bytes) => (bytes / 1024 / 1024).toFixed(2);

const run = async () => {
  if (!process.env.DB_URL) {
    console.error('DB_URL is not set.');
    process.exit(1);
  }

  await mongoose.connect(process.env.DB_URL);
  const emails = mongoose.connection.collection('emails');

  const query = { htmlBody: { $exists: true, $nin: [null, ''] } };
  const total = await emailsCount(emails, query);

  console.log(`\n${APPLY ? 'APPLYING' : 'DRY RUN'} — ${total} document(s) carry an html body\n`);

  let scanned = 0;
  let converted = 0;
  let skipped = 0;
  let before = 0;
  let after = 0;

  const cursor = emails
    .find(query)
    .project({ _id: 1, subject: 1, textBody: 1, htmlBody: 1 })
    .batchSize(BATCH);

  const writes = [];

  for await (const doc of cursor) {
    scanned += 1;

    const next = normalizeIncomingBody({
      text: doc.textBody,
      html: doc.htmlBody,
    });

    /*
     * Nothing readable came out of either part. Leave the document
     * exactly as it is — a smaller database is not worth a lost message.
     */
    if (!next.textBody.trim() && !next.htmlBody.trim()) {
      skipped += 1;
      continue;
    }

    const saving = bodySavings(doc.htmlBody, next.htmlBody);
    before += saving.before;
    after += saving.after;
    converted += 1;

    writes.push({
      updateOne: {
        filter: { _id: doc._id },
        update: {
          $set: { textBody: next.textBody, htmlBody: next.htmlBody },
        },
      },
    });

    if (APPLY && writes.length >= BATCH) {
      await emails.bulkWrite(writes, { ordered: false });
      writes.length = 0;
      process.stdout.write(`  written ${converted}/${total}\r`);
    }
  }

  if (APPLY && writes.length) {
    await emails.bulkWrite(writes, { ordered: false });
  }

  console.log('');
  console.log(`  scanned      : ${scanned}`);
  console.log(`  converted    : ${converted}`);
  console.log(`  left alone   : ${skipped}  (nothing readable could be derived)`);
  console.log(`  html before  : ${mb(before)} MB`);
  console.log(`  html after   : ${mb(after)} MB`);
  console.log(
    `  saved        : ${mb(before - after)} MB` +
      (before ? `  (${Math.round(((before - after) / before) * 100)}% smaller)` : '')
  );

  if (!APPLY) {
    console.log('\nNothing was written. Re-run with --apply to make these changes.');
  }

  await mongoose.disconnect();
};

/* countDocuments on a filter, kept separate so the dry run reads clearly. */
const emailsCount = (collection, query) => collection.countDocuments(query);

run().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
