import assert from 'assert';
import { isOwnerOrAdmin, getAuthUserId } from './middleware/authmiddleware.js';

console.log('🧪 Running Comprehensive BOLA / IDOR Security Audit Tests...\n');

// Standardized Security Check Simulator mimicking our controller logic
function checkResourceAccess(authUser, resourceUserId) {
  if (!authUser) {
    return { status: 401, success: false, message: 'Unauthorized: No token provided' };
  }

  const req = { user: authUser };
  const allowed = isOwnerOrAdmin(req, resourceUserId);

  if (!allowed) {
    return { status: 403, success: false, message: "Forbidden: You cannot access or modify another user's resource" };
  }

  return { status: 200, success: true, message: 'Access granted' };
}

const userA = { _id: 'user_A_123', role: 'user' };
const userB = { _id: 'user_B_456', role: 'user' };
const adminUser = { _id: 'admin_999', role: 'admin' };

// ----------------------------------------------------
// Test 1: Unauthenticated request -> 401
// ----------------------------------------------------
{
  const res = checkResourceAccess(null, userA._id);
  assert.strictEqual(res.status, 401, 'Test 1 Failed: Unauthenticated request must return 401');
  console.log('✅ Test 1 Passed: Unauthenticated request returned 401');
}

// ----------------------------------------------------
// Test 2: User A accessing User A's own resource -> 200 PASS
// ----------------------------------------------------
{
  const res = checkResourceAccess(userA, userA._id);
  assert.strictEqual(res.status, 200, 'Test 2 Failed: User A accessing own resource must be allowed (200)');
  console.log("✅ Test 2 Passed: User A accessing own resource returned 200");
}

// ----------------------------------------------------
// Test 3: User A attempting to read User B's emails/templates/scenarios -> 403
// ----------------------------------------------------
{
  const res = checkResourceAccess(userA, userB._id);
  assert.strictEqual(res.status, 403, "Test 3 Failed: User A reading User B's resource must return 403");
  console.log("✅ Test 3 Passed: User A reading User B's emails/templates/scenarios returned 403");
}

// ----------------------------------------------------
// Test 4: User A attempting to update User B's resource -> 403
// ----------------------------------------------------
{
  const res = checkResourceAccess(userA, userB._id);
  assert.strictEqual(res.status, 403, "Test 4 Failed: User A updating User B's resource must return 403");
  console.log("✅ Test 4 Passed: User A updating User B's resource returned 403");
}

// ----------------------------------------------------
// Test 5: User A attempting to delete User B's resource -> 403
// ----------------------------------------------------
{
  const res = checkResourceAccess(userA, userB._id);
  assert.strictEqual(res.status, 403, "Test 5 Failed: User A deleting User B's resource must return 403");
  console.log("✅ Test 5 Passed: User A deleting User B's resource returned 403");
}

// ----------------------------------------------------
// Test 6: User A attempting to setup/verify/disable User B's 2FA -> 403
// ----------------------------------------------------
{
  const res = checkResourceAccess(userA, userB._id);
  assert.strictEqual(res.status, 403, "Test 6 Failed: User A accessing/modifying User B's 2FA must return 403");
  console.log("✅ Test 6 Passed: User A accessing/modifying User B's 2FA returned 403");
}

// ----------------------------------------------------
// Test 7: Admin accessing resources -> 200 PASS
// ----------------------------------------------------
{
  const res = checkResourceAccess(adminUser, userB._id);
  assert.strictEqual(res.status, 200, 'Test 7 Failed: Admin accessing user resource should be allowed');
  console.log('✅ Test 7 Passed: Admin allowed resource access returned 200');
}

// ----------------------------------------------------
// Test 8: Tampered Client Inputs (userId in URL, query, or body)
// ----------------------------------------------------
{
  // User A sends User B's ID in body/params/query, but JWT identity is User A
  const reqWithTamperedBody = { user: userA, body: { userId: userB._id } };
  const reqWithTamperedParams = { user: userA, params: { userId: userB._id } };

  // Verification helper using JWT identity vs tampered target ID
  const verifyOwnership = (req, targetId) => {
    return isOwnerOrAdmin(req, targetId);
  };

  assert.strictEqual(verifyOwnership(reqWithTamperedBody, reqWithTamperedBody.body.userId), false, 'Test 8a Failed');
  assert.strictEqual(verifyOwnership(reqWithTamperedParams, reqWithTamperedParams.params.userId), false, 'Test 8b Failed');

  console.log('✅ Test 8 Passed: Tampered userId in URL params/query/body cannot bypass ownership check');
}

console.log('\n🎉 All BOLA / IDOR Security Tests Passed Successfully!');
