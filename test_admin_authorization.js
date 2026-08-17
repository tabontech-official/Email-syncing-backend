import assert from 'assert';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import app from './app.js';

console.log('🧪 Running Comprehensive Admin Authorization Security Tests...\n');

const secret = process.env.SECRET_KEY || process.env.JWT_SECRET || '2323';

const normalUserToken = jwt.sign(
  { payLoad: { _id: '65f1a2b3c4d5e6f7a8b9c0d1', email: 'user@example.com', role: 'user' } },
  secret
);

const adminUserToken = jwt.sign(
  { payLoad: { _id: '65f1a2b3c4d5e6f7a8b9c0d9', email: 'admin@example.com', role: 'admin' } },
  secret
);

const sampleUserId = '65f1a2b3c4d5e6f7a8b9c0d2';
const sampleConnectionId = '65f1a2b3c4d5e6f7a8b9c0d3';

// ----------------------------------------------------
// Test 1: Unauthenticated request to Admin Endpoints -> 401
// ----------------------------------------------------
{
  const endpoints = [
    { method: 'get', url: '/auth/users' },
    { method: 'get', url: '/auth/template-usage' },
    { method: 'get', url: '/auth/summary' },
    { method: 'get', url: '/auth/user-activity' },
    { method: 'get', url: '/auth/email-tracking' },
    { method: 'delete', url: `/auth/user/${sampleUserId}` },
    { method: 'post', url: '/auth/users/bulk-delete' },
    { method: 'put', url: `/auth/admin/give-pro/${sampleUserId}` },
    { method: 'put', url: `/auth/admin/revoke-pro/${sampleUserId}` },
    { method: 'post', url: `/auth/admin/login-as/${sampleUserId}` },
    { method: 'get', url: '/api/ai-config' },
    { method: 'put', url: '/api/ai-config' },
    { method: 'put', url: '/api/landing-page' },
    { method: 'put', url: '/api/product-page/product-page' },
    { method: 'put', url: '/admin/scripts' },
  ];

  for (const ep of endpoints) {
    const res = await request(app)[ep.method](ep.url);
    assert.strictEqual(
      res.status,
      401,
      `Unauthenticated request to ${ep.method.toUpperCase()} ${ep.url} should be 401, got ${res.status}`
    );
  }
  console.log('✅ Test 1 Passed: All 15 admin endpoints reject unauthenticated requests with 401 Unauthorized');
}

// ----------------------------------------------------
// Test 2: Normal Authenticated User -> 403 Forbidden
// ----------------------------------------------------
{
  const endpoints = [
    { method: 'get', url: '/auth/users' },
    { method: 'get', url: '/auth/template-usage' },
    { method: 'get', url: '/auth/summary' },
    { method: 'get', url: '/auth/user-activity' },
    { method: 'get', url: '/auth/email-tracking' },
    { method: 'delete', url: `/auth/user/${sampleUserId}` },
    { method: 'post', url: '/auth/users/bulk-delete', body: { ids: [sampleUserId] } },
    { method: 'put', url: `/auth/admin/give-pro/${sampleUserId}`, body: { durationInDays: 30 } },
    { method: 'put', url: `/auth/admin/revoke-pro/${sampleUserId}` },
    { method: 'post', url: `/auth/admin/login-as/${sampleUserId}` },
    { method: 'get', url: '/api/ai-config' },
    { method: 'put', url: '/api/ai-config', body: { model: 'gpt-4' } },
    { method: 'put', url: '/api/landing-page', body: { title: 'Hacked' } },
    { method: 'put', url: '/api/product-page/product-page', body: { hero: { title: 'Hacked' } } },
    { method: 'put', url: '/admin/scripts', body: { scripts: [] } },
  ];

  for (const ep of endpoints) {
    let reqObj = request(app)[ep.method](ep.url).set('Authorization', `Bearer ${normalUserToken}`);
    if (ep.body) reqObj = reqObj.send(ep.body);

    const res = await reqObj;
    assert.strictEqual(
      res.status,
      403,
      `Normal user request to ${ep.method.toUpperCase()} ${ep.url} should be 403, got ${res.status}`
    );
  }
  console.log('✅ Test 2 Passed: All 15 admin endpoints reject normal authenticated users with 403 Forbidden');
}

// ----------------------------------------------------
// Test 3: Tampered Request Body containing role: "admin" -> 403 Forbidden
// ----------------------------------------------------
{
  const res = await request(app)
    .post(`/auth/admin/login-as/${sampleUserId}`)
    .set('Authorization', `Bearer ${normalUserToken}`)
    .send({ role: 'admin', isAdmin: true });

  assert.strictEqual(res.status, 403, 'Tampered request body role:"admin" must not grant admin access');
  console.log('✅ Test 3 Passed: Tampered request body containing role:"admin" does not grant authorization');
}

// ----------------------------------------------------
// Test 4: Tampered URL Query containing ?role=admin -> 403 Forbidden
// ----------------------------------------------------
{
  const res = await request(app)
    .get('/auth/users?role=admin&admin=true')
    .set('Authorization', `Bearer ${normalUserToken}`);

  assert.strictEqual(res.status, 403, 'Tampered URL query parameters must not bypass authorization');
  console.log('✅ Test 4 Passed: Tampered URL query parameters do not bypass authorization');
}

// ----------------------------------------------------
// Test 5: Admin Authenticated User Access -> Allowed
// ----------------------------------------------------
{
  const res = await request(app)
    .get('/api/ai-config')
    .set('Authorization', `Bearer ${adminUserToken}`);

  assert.strictEqual(res.status, 200, 'Admin request to AI config should return 200 OK');
  console.log('✅ Test 5 Passed: Authorized admin requests access endpoints successfully (200 OK)');
}

console.log('\n🎉 All Admin Authorization Security Tests Passed Successfully!');
process.exit(0);
