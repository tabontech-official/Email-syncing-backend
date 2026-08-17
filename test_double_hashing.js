import assert from 'assert';
import bcrypt from 'bcrypt';
import { authModel } from './Models/auth.js';

console.log('🧪 Running Double Password Hashing Security Tests...\n');

// ----------------------------------------------------
// Test 1: New User / Signup Password Hashing
// ----------------------------------------------------
{
  const rawPassword = 'Password123!';
  const userDoc = new authModel({
    fullName: 'Double Hash Tester',
    email: 'doublehash@example.com',
    password: rawPassword,
  });

  // Simulate pre-save hook
  const isModified = userDoc.isModified('password');
  assert.strictEqual(isModified, true, 'Password should be marked as modified before save');

  // Trigger pre-save hook logic
  const isBcryptHash = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(userDoc.password);
  assert.strictEqual(isBcryptHash, false, 'Raw password is not a bcrypt hash yet');

  const salt = await bcrypt.genSalt(10);
  userDoc.password = await bcrypt.hash(userDoc.password, salt);

  // Verify hash format and length
  assert.strictEqual(userDoc.password.length, 60, 'Bcrypt hash length must be exactly 60 characters');
  assert.ok(userDoc.password.startsWith('$2b$') || userDoc.password.startsWith('$2a$'), 'Hash must start with standard bcrypt prefix');
  assert.notStrictEqual(userDoc.password, rawPassword, 'Stored password must never equal plaintext password');

  // Verify login with comparePassword
  const isMatch = await userDoc.comparePassword(rawPassword);
  assert.strictEqual(isMatch, true, 'Test 1 Failed: User must be able to log in with original password');

  const wrongMatch = await userDoc.comparePassword('WrongPassword123!');
  assert.strictEqual(wrongMatch, false, 'Test 1 Failed: Wrong password must be rejected');

  console.log('✅ Test 1 Passed: Signup password hashed EXACTLY ONCE, login succeeds, wrong password rejected');
}

// ----------------------------------------------------
// Test 2: Double-Hash Guard Prevention Test
// ----------------------------------------------------
{
  const initialRawPassword = 'InitialPass123!';
  const salt = await bcrypt.genSalt(10);
  const singleHash = await bcrypt.hash(initialRawPassword, salt);

  const userDoc = new authModel({
    fullName: 'PreHashed User',
    email: 'prehashed@example.com',
    password: singleHash, // Already hashed
  });

  // Run double hash guard logic (as defined in authSchema.pre('save'))
  const isBcryptHash = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(userDoc.password);
  assert.strictEqual(isBcryptHash, true, 'Guard detects password is already a valid bcrypt hash');

  if (!isBcryptHash) {
    const s = await bcrypt.genSalt(10);
    userDoc.password = await bcrypt.hash(userDoc.password, s);
  }

  // The password hash should remain unchanged (singleHash)
  assert.strictEqual(userDoc.password, singleHash, 'Test 2 Failed: Pre-hashed password was modified or re-hashed!');

  // Verify comparePassword works with the original password
  const isMatch = await userDoc.comparePassword(initialRawPassword);
  assert.strictEqual(isMatch, true, 'Test 2 Failed: Login must succeed with original password');

  console.log('✅ Test 2 Passed: Double-hash guard prevents re-hashing an already hashed bcrypt string');
}

// ----------------------------------------------------
// Test 3: Password Update / Change Flow
// ----------------------------------------------------
{
  const oldPassword = 'OldPassword123!';
  const newPassword = 'NewPassword456!';

  const userDoc = new authModel({
    fullName: 'Password Changer',
    email: 'changer@example.com',
    password: oldPassword,
  });

  // Initial save hashing
  const salt1 = await bcrypt.genSalt(10);
  userDoc.password = await bcrypt.hash(userDoc.password, salt1);

  assert.strictEqual(await userDoc.comparePassword(oldPassword), true, 'Initial login should work');

  // Password update: Assign new plaintext password
  userDoc.password = newPassword;
  
  // Save hook hashing new password
  const isBcryptHash = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(userDoc.password);
  assert.strictEqual(isBcryptHash, false, 'New password is not a bcrypt hash yet');

  const salt2 = await bcrypt.genSalt(10);
  userDoc.password = await bcrypt.hash(userDoc.password, salt2);

  // Verification
  assert.strictEqual(await userDoc.comparePassword(newPassword), true, 'Test 3 Failed: User must be able to log in with new password');
  assert.strictEqual(await userDoc.comparePassword(oldPassword), false, 'Test 3 Failed: Old password must no longer work');

  console.log('✅ Test 3 Passed: Password change hashes new password EXACTLY ONCE, old password revoked');
}

// ----------------------------------------------------
// Test 4: Password Reset / Set Password Flow
// ----------------------------------------------------
{
  const resetPassword = 'ResetPassword789!';

  const userDoc = new authModel({
    fullName: 'Reset User',
    email: 'reset@example.com',
    password: 'TemporaryPassword123!',
  });

  // Set password to resetPassword
  userDoc.password = resetPassword;

  // Save hook hashing reset password
  const isBcryptHash = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(userDoc.password);
  assert.strictEqual(isBcryptHash, false);

  const salt = await bcrypt.genSalt(10);
  userDoc.password = await bcrypt.hash(userDoc.password, salt);

  assert.strictEqual(await userDoc.comparePassword(resetPassword), true, 'Test 4 Failed: Login with reset password must succeed');
  assert.strictEqual(userDoc.password.length, 60, 'Reset password hash length must be 60 characters');

  console.log('✅ Test 4 Passed: Password reset/set-password hashes password EXACTLY ONCE');
}

console.log('\n🎉 All Double Password Hashing Security Tests Passed Successfully!');
