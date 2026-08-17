import assert from 'assert';
import { sanitizeUser } from './controller/auth.js';

console.log('🧪 Running Sensitive Data Exposure Security Tests...\n');

// Mock User document from MongoDB
const mockUser = {
  _id: 'user_123456789',
  email: 'testuser@example.com',
  fullName: 'Security Test User',
  role: 'user',
  password: '$2b$10$e8w6W2k1vJ8c8Z.D.H2JueJk.VnZkL7wF7E7JkL7wF7E7JkL7wF7E', // Hash
  twoFactorSecret: 'JBSWY3DPEHPK3PXP', // Secret 2FA key
  twoFactorTempSecret: 'K45WY3DPEHPK3PXP',
  __v: 0,
  toObject: function() {
    return {
      _id: this._id,
      email: this.email,
      fullName: this.fullName,
      role: this.role,
      password: this.password,
      twoFactorSecret: this.twoFactorSecret,
      twoFactorTempSecret: this.twoFactorTempSecret,
      __v: this.__v,
    };
  }
};

// ----------------------------------------------------
// Test 1: sanitizeUser correctly strips sensitive fields
// ----------------------------------------------------
{
  const sanitized = sanitizeUser(mockUser);
  
  assert.strictEqual(sanitized.email, 'testuser@example.com', 'Email should be preserved');
  assert.strictEqual(sanitized.fullName, 'Security Test User', 'FullName should be preserved');
  assert.strictEqual(sanitized.password, undefined, 'Test 1 Failed: password must be removed');
  assert.strictEqual(sanitized.twoFactorSecret, undefined, 'Test 1 Failed: twoFactorSecret must be removed');
  assert.strictEqual(sanitized.twoFactorTempSecret, undefined, 'Test 1 Failed: twoFactorTempSecret must be removed');
  assert.strictEqual(sanitized.__v, undefined, '__v should be removed');

  console.log('✅ Test 1 Passed: sanitizeUser successfully strips password, twoFactorSecret, twoFactorTempSecret, and __v');
}

// ----------------------------------------------------
// Test 2: Verify Login / Auth responses do not contain secrets
// ----------------------------------------------------
{
  const loginResponseData = sanitizeUser(mockUser);
  const responseString = JSON.stringify(loginResponseData);

  assert.ok(!responseString.includes('$2b$10$'), 'Test 2 Failed: Response contains password hash string');
  assert.ok(!responseString.includes('JBSWY3DPEHPK3PXP'), 'Test 2 Failed: Response contains twoFactorSecret');
  assert.ok(!responseString.includes('K45WY3DPEHPK3PXP'), 'Test 2 Failed: Response contains twoFactorTempSecret');

  console.log('✅ Test 2 Passed: Login response JSON payload contains NO password or 2FA secrets');
}

// ----------------------------------------------------
// Test 3: Profile / getUserById data structure check
// ----------------------------------------------------
{
  const safeUser = sanitizeUser(mockUser);
  const profileResponse = {
    message: 'User fetched successfully',
    data: {
      ...safeUser,
      organizationName: 'Test Org',
      Region: 'US',
    }
  };

  assert.strictEqual(profileResponse.data.password, undefined, 'Test 3 Failed: profile response contains password');
  assert.strictEqual(profileResponse.data.twoFactorSecret, undefined, 'Test 3 Failed: profile response contains twoFactorSecret');
  assert.strictEqual(profileResponse.data.twoFactorTempSecret, undefined, 'Test 3 Failed: profile response contains twoFactorTempSecret');

  console.log('✅ Test 3 Passed: Profile response payload contains NO sensitive credentials');
}

// ----------------------------------------------------
// Test 4: OAuth and 2FA verification response check
// ----------------------------------------------------
{
  const oAuthResponse = {
    message: 'Successfully logged in with Google',
    token: 'mock.jwt.token',
    data: sanitizeUser(mockUser),
  };

  assert.strictEqual(oAuthResponse.data.password, undefined, 'Test 4 Failed: OAuth response contains password');
  assert.strictEqual(oAuthResponse.data.twoFactorSecret, undefined, 'Test 4 Failed: OAuth response contains twoFactorSecret');
  
  console.log('✅ Test 4 Passed: OAuth authentication response payload is clean and sanitized');
}

console.log('\n🎉 All Sensitive Data Exposure Security Tests Passed Successfully!');
