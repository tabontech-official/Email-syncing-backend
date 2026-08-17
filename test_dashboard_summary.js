import assert from 'assert';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import app from './app.js';
import { authModel } from './Models/auth.js';

console.log('🧪 Running Dashboard Summary Security & Functionality Tests...\n');

const secret = process.env.SECRET_KEY || process.env.JWT_SECRET || '2323';

const userAId = '65f1a2b3c4d5e6f7a8b9c0a1';
const userBId = '65f1a2b3c4d5e6f7a8b9c0b2';

const userAToken = jwt.sign(
  { payLoad: { _id: userAId, email: 'usera@example.com', role: 'user' } },
  secret
);

const userBToken = jwt.sign(
  { payLoad: { _id: userBId, email: 'userb@example.com', role: 'user' } },
  secret
);

// Seed test user into MongoDB
await authModel.updateOne(
  { _id: userAId },
  {
    $set: {
      email: 'usera@example.com',
      organizationName: 'Test Org',
      role: 'user',
      subscription: { plan: 'Explore', aiRepliesUsed: 5 },
    },
  },
  { upsert: true }
);

// ----------------------------------------------------
// Test 1: Unauthenticated Request -> 401 Unauthorized
// ----------------------------------------------------
{
  const res = await request(app).get(`/auth/dashboard-summary/${userAId}`);
  assert.strictEqual(res.status, 401, 'Test 1 Failed: Unauthenticated request must return 401');
  assert.strictEqual(res.body.success, false);
  console.log('✅ Test 1 Passed: Unauthenticated request returns 401 Unauthorized');
}

// ----------------------------------------------------
// Test 2: BOLA / IDOR Protection — User A accessing User B's Summary -> 403 Forbidden
// ----------------------------------------------------
{
  const res = await request(app)
    .get(`/auth/dashboard-summary/${userBId}`)
    .set('Authorization', `Bearer ${userAToken}`);

  assert.strictEqual(res.status, 403, 'Test 2 Failed: User A accessing User B summary must return 403');
  assert.strictEqual(res.body.success, false);
  console.log('✅ Test 2 Passed: User A cannot access User B dashboard summary (BOLA/IDOR protected)');
}

// ----------------------------------------------------
// Test 3: Authorized Request — User A accessing own Summary -> 200 OK
// ----------------------------------------------------
{
  const res = await request(app)
    .get(`/auth/dashboard-summary/${userAId}`)
    .set('Authorization', `Bearer ${userAToken}`);

  assert.strictEqual(res.status, 200, 'Test 3 Failed: Authorized user summary request must return 200 OK');
  assert.strictEqual(res.body.success, true);
  assert.ok(res.body.stats !== undefined, 'Stats object must exist');
  assert.ok(typeof res.body.stats.total === 'number');
  assert.ok(typeof res.body.stats.secured === 'number');
  assert.ok(typeof res.body.stats.replied === 'number');
  assert.ok(typeof res.body.stats.pending === 'number');
  assert.ok(res.body.subscription !== undefined);
  assert.ok(Array.isArray(res.body.recentScenarios));

  console.log('✅ Test 3 Passed: Authorized user summary returns valid response contract');
}

// ----------------------------------------------------
// Test 4: Sensitive Fields Exclusion Check
// ----------------------------------------------------
{
  const res = await request(app)
    .get(`/auth/dashboard-summary/${userAId}`)
    .set('Authorization', `Bearer ${userAToken}`);

  const userObj = res.body.user || {};
  assert.strictEqual(userObj.password, undefined, 'password must NOT be exposed');
  assert.strictEqual(userObj.twoFactorSecret, undefined, 'twoFactorSecret must NOT be exposed');
  assert.strictEqual(userObj.twoFactorTempSecret, undefined, 'twoFactorTempSecret must NOT be exposed');
  assert.strictEqual(userObj.__v, undefined, '__v must NOT be exposed');

  console.log('✅ Test 4 Passed: Dashboard summary contains NO sensitive fields (password, 2FA secrets)');
}

console.log('\n🎉 All Dashboard Summary Security & Functionality Tests Passed Successfully!');
process.exit(0);
