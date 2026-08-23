/*
|--------------------------------------------------------------------------
| ENCRYPTION_KEY Rotation — Re-encryption Migration
|--------------------------------------------------------------------------
|
| Decrypts every encrypted field with the OLD key and re-encrypts it with
| the NEW key, in a single pass, so nothing is left orphaned.
|
| Run this BEFORE changing ENCRYPTION_KEY in Vercel. The old key must
| still be available to read existing rows.
|
| USAGE
|   Dry run (no writes — do this first):
|     OLD_ENCRYPTION_KEY=<old64hex> NEW_ENCRYPTION_KEY=<new64hex> \
|       node scripts/reencrypt-secrets.mjs
|
|   Apply:
|     OLD_ENCRYPTION_KEY=<old64hex> NEW_ENCRYPTION_KEY=<new64hex> \
|       node scripts/reencrypt-secrets.mjs --apply
|
| No key is read from .env and none is hardcoded — both must be passed in
| explicitly, so this cannot silently run against the wrong key.
|
| SAFETY PROPERTIES
|   - Strict decrypt: fails loudly. The app's own decrypt() helper returns
|     its input on failure, which would let a corrupt value pass silently
|     and be "re-encrypted" as garbage. This uses its own strict version.
|   - Round-trip verified: every new ciphertext is decrypted with the NEW
|     key and compared to the original plaintext BEFORE any write.
|   - Backup: original ciphertexts are written to a JSON file outside the
|     repo before the first write, so a rollback is possible.
|   - Plaintext is never logged or written to disk.
|
*/

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';

const ALGO = 'aes-256-cbc';
const APPLY = process.argv.includes('--apply');

/* "<32-hex IV>:<hex ciphertext>" — the format encrypt() produces. */
const ENC_SHAPE = /^[0-9a-f]{32}:[0-9a-f]+$/i;

const TARGETS = [
  ['connections', 'smtp.password'],
  ['connections', 'imap.password'],
  ['connections', 'tokens.access_token'],
  ['connections', 'tokens.refresh_token'],
  ['connections', 'microsoftOAuth.accessToken'],
  ['connections', 'microsoftOAuth.refreshToken'],
  ['stripeconfigs', 'secretKeyEncrypted'],
  ['stripeconfigs', 'webhookSecretEncrypted'],
];

const keyBuf = (hex, label) => {
  const v = String(hex || '').trim();
  if (!/^[0-9a-f]{64}$/i.test(v)) {
    console.error(`FATAL: ${label} must be exactly 64 hex characters.`);
    process.exit(1);
  }
  return Buffer.from(v, 'hex');
};

/* Throws on any failure — deliberately unlike the app's lenient decrypt(). */
const strictDecrypt = (value, key) => {
  if (typeof value !== 'string' || !ENC_SHAPE.test(value)) {
    throw new Error('value is not in ivHex:cipherHex form');
  }
  const [ivHex, dataHex] = value.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  if (iv.length !== 16) throw new Error('IV is not 16 bytes');

  const d = crypto.createDecipheriv(ALGO, key, iv);
  return Buffer.concat([
    d.update(Buffer.from(dataHex, 'hex')),
    d.final(),
  ]).toString('utf8');
};

const encryptWith = (plaintext, key) => {
  const iv = crypto.randomBytes(16);
  const c = crypto.createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([c.update(String(plaintext), 'utf8'), c.final()]);
  return `${iv.toString('hex')}:${enc.toString('hex')}`;
};

const dig = (doc, p) =>
  p.split('.').reduce((o, k) => (o == null ? undefined : o[k]), doc);

/* ---------------------------------------------------------------- run */

const OLD = keyBuf(process.env.OLD_ENCRYPTION_KEY, 'OLD_ENCRYPTION_KEY');
const NEW = keyBuf(process.env.NEW_ENCRYPTION_KEY, 'NEW_ENCRYPTION_KEY');

if (OLD.equals(NEW)) {
  console.error('FATAL: OLD_ENCRYPTION_KEY and NEW_ENCRYPTION_KEY are identical.');
  process.exit(1);
}

const dbUri = (process.env.DB_URL || process.env.DB_URI || '').trim();
if (!dbUri) {
  console.error('FATAL: DB_URL is not set.');
  process.exit(1);
}

await mongoose.connect(dbUri, { serverSelectionTimeoutMS: 20000 });
const db = mongoose.connection;

console.log(APPLY ? '=== APPLY MODE (writes enabled) ===' : '=== DRY RUN (no writes) ===');
console.log('');

const planned = [];
const failures = [];

for (const [coll, fieldPath] of TARGETS) {
  const docs = await db.collection(coll).find({}).toArray();

  for (const doc of docs) {
    const current = dig(doc, fieldPath);
    if (!current || typeof current !== 'string') continue;

    if (!ENC_SHAPE.test(current)) {
      failures.push({ coll, fieldPath, _id: doc._id, reason: 'not encrypted-looking' });
      continue;
    }

    try {
      const plaintext = strictDecrypt(current, OLD);
      const reEncrypted = encryptWith(plaintext, NEW);

      /* Round-trip: the new ciphertext must decrypt back to the same value. */
      const check = strictDecrypt(reEncrypted, NEW);
      if (check !== plaintext) throw new Error('round-trip mismatch');

      planned.push({
        coll,
        fieldPath,
        _id: doc._id,
        before: current,
        after: reEncrypted,
        plaintextLength: plaintext.length,
      });
    } catch (err) {
      failures.push({ coll, fieldPath, _id: doc._id, reason: err.message });
    }
  }
}

console.log('re-encryptable values:', planned.length);
for (const p of planned) {
  console.log(
    `  ${p.coll}.${p.fieldPath}`.padEnd(48) +
      `${String(p._id).slice(-6)}  plaintext ${String(p.plaintextLength).padStart(5)} chars  ` +
      `${p.before.slice(0, 8)}… -> ${p.after.slice(0, 8)}…`
  );
}

if (failures.length) {
  console.log('');
  console.log('FAILED to decrypt with the OLD key:', failures.length);
  for (const f of failures) {
    console.log(`  ${f.coll}.${f.fieldPath}  ${String(f._id).slice(-6)}  — ${f.reason}`);
  }
  console.log('');
  console.log('Refusing to continue: these rows would be orphaned by a key change.');
  await mongoose.disconnect();
  process.exit(1);
}

if (!APPLY) {
  console.log('');
  console.log('Dry run complete. Every value decrypted with the OLD key and');
  console.log('round-tripped under the NEW key. Re-run with --apply to write.');
  await mongoose.disconnect();
  process.exit(0);
}

/* ------------------------------------------------------------- backup */

const backupDir = path.resolve(process.cwd(), '..', '.encryption-rotation-backup');
fs.mkdirSync(backupDir, { recursive: true });
const backupFile = path.join(backupDir, `ciphertext-backup-${Date.now()}.json`);

fs.writeFileSync(
  backupFile,
  JSON.stringify(
    planned.map((p) => ({
      coll: p.coll,
      fieldPath: p.fieldPath,
      _id: String(p._id),
      before: p.before,
    })),
    null,
    2
  )
);
console.log('');
console.log('backup of ORIGINAL ciphertexts written to:');
console.log('  ' + backupFile);
console.log('  (outside the git repo — delete once the rotation is confirmed)');

/* -------------------------------------------------------------- write */

let written = 0;
for (const p of planned) {
  await db
    .collection(p.coll)
    .updateOne({ _id: p._id }, { $set: { [p.fieldPath]: p.after } });
  written++;
}

console.log('');
console.log('updated', written, 'values.');

/* ------------------------------------------------------- post-verify */

let ok = 0;
const bad = [];
for (const p of planned) {
  const doc = await db.collection(p.coll).findOne({ _id: p._id });
  const v = dig(doc, p.fieldPath);
  try {
    strictDecrypt(v, NEW);
    ok++;
  } catch (err) {
    bad.push({ ...p, reason: err.message });
  }
}

console.log('post-verify: ' + ok + '/' + planned.length + ' decrypt cleanly under the NEW key');
if (bad.length) {
  console.log('FAILED post-verify:');
  for (const b of bad) console.log(`  ${b.coll}.${b.fieldPath} ${String(b._id).slice(-6)} — ${b.reason}`);
}

await mongoose.disconnect();
process.exit(bad.length ? 1 : 0);
