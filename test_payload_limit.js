import assert from 'assert';
import express from 'express';
import request from 'supertest';

console.log('🧪 Running Payload Size Limitation & DoS Prevention Tests...\n');

// Build an isolated Express test application with 10MB JSON limit & 413 error handler
const app = express();
app.use(express.json({ limit: '10mb' }));

app.post('/api/test-payload', (req, res) => {
  res.status(200).json({ success: true, receivedBytes: JSON.stringify(req.body).length });
});

// Express 413 Error Handler
app.use((err, req, res, next) => {
  if (err.type === 'entity.too.large' || err.status === 413) {
    return res.status(413).json({
      success: false,
      error: 'Payload Too Large: The request payload exceeds the maximum allowed limit of 10MB.',
      message: 'Payload Too Large: The request payload exceeds the maximum allowed limit of 10MB.',
    });
  }
  next(err);
});

// ----------------------------------------------------
// Test 1: Normal Request (10 KB / 100 KB payload) -> 200 OK
// ----------------------------------------------------
{
  const normalData = { data: 'A'.repeat(100 * 1024) }; // ~100 KB
  const res = await request(app)
    .post('/api/test-payload')
    .send(normalData);

  assert.strictEqual(res.status, 200, 'Test 1 Failed: Normal 100 KB payload must be accepted');
  assert.strictEqual(res.body.success, true);
  console.log('✅ Test 1 Passed: Normal 100 KB payload accepted with 200 OK');
}

// ----------------------------------------------------
// Test 2: Over-Sized Malicious Request (12 MB payload) -> 413 Payload Too Large
// ----------------------------------------------------
{
  const largeData = { data: 'X'.repeat(12 * 1024 * 1024) }; // ~12 MB
  const res = await request(app)
    .post('/api/test-payload')
    .send(largeData);

  assert.strictEqual(res.status, 413, 'Test 2 Failed: 12 MB payload must be rejected with HTTP 413');
  assert.strictEqual(res.body.success, false);
  assert.ok(res.body.error.includes('Payload Too Large'), 'Error response should explicitly state Payload Too Large');
  console.log('✅ Test 2 Passed: 12 MB payload rejected with HTTP 413 Payload Too Large');
}

console.log('\n🎉 All Payload Limitation & DoS Security Tests Passed Successfully!');
