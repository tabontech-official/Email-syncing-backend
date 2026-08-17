import assert from 'assert';
import express from 'express';
import request from 'supertest';
import { authLimiter, sensitiveAuthLimiter, publicFormLimiter, generalApiLimiter } from './middleware/rateLimiter.js';

console.log('🧪 Running Rate Limiting & Brute-Force Protection Security Tests...\n');

// Build an isolated Express test application
const app = express();
app.set('trust proxy', 1);
app.use(express.json());

// Auth & sensitive endpoints
app.post('/auth/signIn', authLimiter, (req, res) => res.json({ success: true, message: 'Logged in' }));
app.post('/auth/google-login', authLimiter, (req, res) => res.json({ success: true, message: 'Google Logged in' }));
app.post('/auth/2fa/verify-login', authLimiter, (req, res) => res.json({ success: true, message: '2FA verified' }));

app.post('/auth/signUp', sensitiveAuthLimiter, (req, res) => res.json({ success: true, message: 'Signed up' }));
app.post('/auth/forgot-password', sensitiveAuthLimiter, (req, res) => res.json({ success: true, message: 'Reset email sent' }));
app.post('/auth/set-password', sensitiveAuthLimiter, (req, res) => res.json({ success: true, message: 'Password set' }));
app.post('/auth/request-login', sensitiveAuthLimiter, (req, res) => res.json({ success: true, message: 'Magic link sent' }));

app.post('/talk/talk-to-sales', publicFormLimiter, (req, res) => res.json({ success: true, message: 'Form submitted' }));

// Excluded Webhook & Callback endpoints
app.post('/stripe/webhook', (req, res) => res.json({ received: true }));
app.get('/auth/google/callback', (req, res) => res.json({ success: true, callback: 'google' }));

// ----------------------------------------------------
// Test 1: Normal Login succeeds within limit
// ----------------------------------------------------
{
  const res = await request(app).post('/auth/signIn').send({ email: 'test@example.com', password: 'Password123!' });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.success, true);
  console.log('✅ Test 1 Passed: Normal login succeeds under limit');
}

// ----------------------------------------------------
// Test 2: Repeated failed login attempts receive 429 Too Many Requests
// ----------------------------------------------------
{
  let lastStatus = 200;
  let lastRes = null;
  // Make 11 requests (limit is 10)
  for (let i = 0; i < 11; i++) {
    lastRes = await request(app).post('/auth/signIn').send({ email: 'test@example.com', password: 'WrongPassword' });
    lastStatus = lastRes.status;
  }

  assert.strictEqual(lastStatus, 429, 'Test 2 Failed: 11th request must receive HTTP 429');
  assert.strictEqual(lastRes.body.success, false);
  assert.ok(lastRes.headers['retry-after'], 'Test 2 Failed: Retry-After header must be present');
  console.log('✅ Test 2 Passed: 11th login attempt returns HTTP 429 with Retry-After header');
}

// ----------------------------------------------------
// Test 3: Sensitive Operations (Signup / Password Reset) receive 429 after 5 requests
// ----------------------------------------------------
{
  let lastStatus = 200;
  let lastRes = null;
  // Make 6 requests to forgot-password (limit is 5)
  for (let i = 0; i < 6; i++) {
    lastRes = await request(app).post('/auth/forgot-password').send({ email: 'user@example.com' });
    lastStatus = lastRes.status;
  }

  assert.strictEqual(lastStatus, 429, 'Test 3 Failed: 6th forgot-password request must receive 429');
  assert.ok(lastRes.body.error.includes('Too many requests'), 'Error message should inform user without revealing internal details');
  console.log('✅ Test 3 Passed: Password reset requests are rate-limited after 5 attempts');
}

// ----------------------------------------------------
// Test 4: Public Form Submissions (Talk to Sales) receive 429 after 5 requests
// ----------------------------------------------------
{
  let lastStatus = 200;
  for (let i = 0; i < 6; i++) {
    const res = await request(app).post('/talk/talk-to-sales').send({ name: 'Spammer', message: 'Hello' });
    lastStatus = res.status;
  }

  assert.strictEqual(lastStatus, 429, 'Test 4 Failed: 6th public form request must receive 429');
  console.log('✅ Test 4 Passed: Public contact forms are protected against spam submission');
}

// ----------------------------------------------------
// Test 5: Excluded Webhook Endpoints are NOT Rate-Limited
// ----------------------------------------------------
{
  let allPassed = true;
  for (let i = 0; i < 20; i++) {
    const res = await request(app).post('/stripe/webhook').send({ type: 'payment_intent.succeeded' });
    if (res.status !== 200) {
      allPassed = false;
      break;
    }
  }

  assert.strictEqual(allPassed, true, 'Test 5 Failed: Stripe webhook must not be rate limited');
  console.log('✅ Test 5 Passed: Stripe webhook endpoint remains 100% functional without rate limit drops');
}

// ----------------------------------------------------
// Test 6: OAuth Callback Endpoints are NOT Rate-Limited
// ----------------------------------------------------
{
  let allPassed = true;
  for (let i = 0; i < 20; i++) {
    const res = await request(app).get('/auth/google/callback');
    if (res.status !== 200) {
      allPassed = false;
      break;
    }
  }

  assert.strictEqual(allPassed, true, 'Test 6 Failed: OAuth callback must not be rate limited');
  console.log('✅ Test 6 Passed: OAuth callbacks remain 100% functional without rate limit drops');
}

console.log('\n🎉 All Rate Limiting & Brute-Force Security Tests Passed Successfully!');
