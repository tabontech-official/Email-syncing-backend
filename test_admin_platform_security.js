import assert from 'assert';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import app from './app.js';
import { authModel } from './Models/auth.js';
import { AuditLogModel } from './Models/AuditLog.js';
import { PlanModel } from './Models/Plan.js';

console.log('🧪 Running SaaS Owner / Admin Platform Security Test Suite...\n');

const secret = process.env.SECRET_KEY || process.env.JWT_SECRET || '2323';

const normalUserId = '65f1a2b3c4d5e6f7a8b9c0e1';
const adminOwnerId = '65f1a2b3c4d5e6f7a8b9c0e2';

const normalUserToken = jwt.sign(
  { payLoad: { _id: normalUserId, email: 'normaluser@example.com', role: 'user' } },
  secret
);

const adminOwnerToken = jwt.sign(
  { payLoad: { _id: adminOwnerId, email: 'adminowner@example.com', role: 'admin' } },
  secret
);

// Seed users into MongoDB
await authModel.updateOne(
  { _id: normalUserId },
  { $set: { email: 'normaluser@example.com', role: 'user' } },
  { upsert: true }
);

await authModel.updateOne(
  { _id: adminOwnerId },
  { $set: { email: 'adminowner@example.com', role: 'admin' } },
  { upsert: true }
);

// ----------------------------------------------------
// Test 1: Unauthenticated Requests -> 401 Unauthorized
// ----------------------------------------------------
{
  const res = await request(app).get('/admin/dashboard');
  assert.strictEqual(res.status, 401, 'Test 1 Failed: Unauthenticated request must return 401');
  assert.strictEqual(res.body.success, false);
  console.log('✅ Test 1 Passed: Unauthenticated request returns 401 Unauthorized');
}

// ----------------------------------------------------
// Test 2: Normal User -> 403 Forbidden
// ----------------------------------------------------
{
  const res = await request(app)
    .get('/admin/dashboard')
    .set('Authorization', `Bearer ${normalUserToken}`);

  assert.strictEqual(res.status, 403, 'Test 2 Failed: Normal user must receive 403');
  assert.strictEqual(res.body.success, false);
  console.log('✅ Test 2 Passed: Normal user rejected with 403 Forbidden');
}

// ----------------------------------------------------
// Test 3: Admin / SaaS Owner -> 200 OK
// ----------------------------------------------------
{
  const res = await request(app)
    .get('/admin/dashboard')
    .set('Authorization', `Bearer ${adminOwnerToken}`);

  assert.strictEqual(res.status, 200, 'Test 3 Failed: Admin/SaaS Owner must receive 200 OK');
  assert.strictEqual(res.body.success, true);
  assert.ok(res.body.metrics !== undefined);
  console.log('✅ Test 3 Passed: Admin / SaaS Owner granted access (200 OK)');
}

// ----------------------------------------------------
// Test 4: Role Tampering (Body / Query / URL) -> 403 Forbidden
// ----------------------------------------------------
{
  const tamperedUserToken = jwt.sign(
    { payLoad: { _id: normalUserId, email: 'attacker@example.com', role: 'user' } },
    secret
  );

  const resBody = await request(app)
    .post('/admin/plans')
    .set('Authorization', `Bearer ${tamperedUserToken}`)
    .send({ role: 'admin', name: 'Fake Plan', monthlyPrice: 1 });

  assert.strictEqual(resBody.status, 403, 'Test 4a Failed: Body role tampering must fail');

  const resQuery = await request(app)
    .get('/admin/dashboard?role=admin')
    .set('Authorization', `Bearer ${tamperedUserToken}`);

  assert.strictEqual(resQuery.status, 403, 'Test 4b Failed: Query role tampering must fail');

  console.log('✅ Test 4 Passed: Role tampering in body and query rejected with 403 Forbidden');
}

// ----------------------------------------------------
// Test 5: Sensitive Stripe Secret Masking & Protection
// ----------------------------------------------------
{
  const res = await request(app)
    .get('/admin/stripe-config')
    .set('Authorization', `Bearer ${adminOwnerToken}`);

  assert.strictEqual(res.status, 200);
  const secretKeyMasked = res.body.config?.secretKeyMasked || '';
  assert.ok(secretKeyMasked.includes('••••'), 'Secret key MUST be masked in API response');
  assert.strictEqual(res.body.config.secretKey, undefined, 'Unencrypted secretKey must NEVER be returned');

  console.log('✅ Test 5 Passed: Sensitive Stripe secrets are strictly masked and never returned in API responses');
}

// ----------------------------------------------------
// Test 6: Audit Log Verification (No Secrets Recorded)
// ----------------------------------------------------
{
  await request(app)
    .put('/admin/stripe-config')
    .set('Authorization', `Bearer ${adminOwnerToken}`)
    .send({
      mode: 'test',
      publishableKey: 'pk_test_sample123',
      secretKey: 'sk_test_super_secret_key_9999',
    });

  const auditLogs = await AuditLogModel.find({ action: 'UPDATE_STRIPE_CONFIG' }).lean();
  assert.ok(auditLogs.length > 0, 'Audit log entry must be created');

  const logStr = JSON.stringify(auditLogs);
  assert.strictEqual(logStr.includes('sk_test_super_secret_key_9999'), false, 'Stripe secret key must NOT exist in audit logs');

  console.log('✅ Test 6 Passed: Audit logs strictly exclude Stripe secret keys and sensitive tokens');
}

// ----------------------------------------------------
// Test 7: Plan CRUD Authorization
// ----------------------------------------------------
{
  const resUser = await request(app)
    .post('/admin/plans')
    .set('Authorization', `Bearer ${normalUserToken}`)
    .send({ name: 'Pro Plan', monthlyPrice: 29.99 });

  assert.strictEqual(resUser.status, 403);

  await PlanModel.deleteOne({ name: 'SaaS Owner Custom Plan' });

  const resAdmin = await request(app)
    .post('/admin/plans')
    .set('Authorization', `Bearer ${adminOwnerToken}`)
    .send({ name: 'SaaS Owner Custom Plan', monthlyPrice: 99.99, yearlyPrice: 89.99 });

  assert.strictEqual(resAdmin.status, 201);
  assert.strictEqual(resAdmin.body.success, true);

  console.log('✅ Test 7 Passed: Plan CRUD operations require Admin authorization');
}

console.log('\n🎉 All Admin Platform Security & Authorization Tests Passed Successfully!');
process.exit(0);
