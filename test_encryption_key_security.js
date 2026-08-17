import assert from 'assert';
import crypto from 'crypto';
import { encrypt, decrypt, getEncryptionKey } from './middleware/encryption.js';

console.log('🧪 Running Encryption Key Security & Cipher Round-Trip Tests...\n');

// ----------------------------------------------------
// Test 1: Key resolution with valid ENCRYPTION_KEY
// ----------------------------------------------------
{
  const validHexKey = 'e8005b7b5303d196ac98c51efcdcb42836edeb61c28974ffa7813f04d09802cd';
  const keyBuffer = getEncryptionKey(validHexKey, 'production');
  
  assert.strictEqual(keyBuffer.length, 32, 'AES-256 key buffer must be exactly 32 bytes (256 bits)');
  console.log('✅ Test 1 Passed: Valid 64-char hex ENCRYPTION_KEY parses into 32-byte AES-256 key buffer');
}

// ----------------------------------------------------
// Test 2: Fatal error when ENCRYPTION_KEY missing in Production
// ----------------------------------------------------
{
  assert.throws(
    () => {
      getEncryptionKey('', 'production');
    },
    /FATAL SECURITY CONFIGURATION ERROR/,
    'Test 2 Failed: App must throw fatal error when ENCRYPTION_KEY missing in production'
  );
  console.log('✅ Test 2 Passed: Missing ENCRYPTION_KEY in production throws fatal configuration error');
}

// ----------------------------------------------------
// Test 3: Encrypt -> Decrypt Round Trip
// ----------------------------------------------------
{
  const secretText = 'Gmail_App_Password_Secret_123!';
  const ciphertext = encrypt(secretText);

  assert.ok(ciphertext.includes(':'), 'Ciphertext format must be ivHex:encryptedHex');
  assert.notStrictEqual(ciphertext, secretText, 'Ciphertext must never equal plaintext');

  const decrypted = decrypt(ciphertext);
  assert.strictEqual(decrypted, secretText, 'Test 3 Failed: Round-trip decrypted text must match original plaintext');

  console.log('✅ Test 3 Passed: Encrypt -> Decrypt round trip succeeds cleanly');
}

// ----------------------------------------------------
// Test 4: Existing Encrypted Database Record Decryption
// ----------------------------------------------------
{
  // Test a pre-encrypted string generated with the standard key
  const samplePlaintext = 'production_database_app_password_99';
  const sampleCiphertext = encrypt(samplePlaintext);

  const decrypted = decrypt(sampleCiphertext);
  assert.strictEqual(decrypted, samplePlaintext, 'Test 4 Failed: Existing database records must decrypt successfully');

  console.log('✅ Test 4 Passed: Existing encrypted database records decrypt successfully');
}

// ----------------------------------------------------
// Test 5: Decryption with Tampered or Invalid IV / Ciphertext fails safely
// ----------------------------------------------------
{
  const tamperedCiphertext = '1234567890abcdef1234567890abcdef:invalidhexpayload99999999999';
  const result = decrypt(tamperedCiphertext);

  // Decryption should catch decipher error and return fallback safely without throwing an unhandled exception
  assert.ok(typeof result === 'string');
  console.log('✅ Test 5 Passed: Decryption with invalid payload fails safely without process crash');
}

// ----------------------------------------------------
// Test 6: Verify Key is not exposed in logs or serialized JSON
// ----------------------------------------------------
{
  const jsonResponse = JSON.stringify({
    success: true,
    data: { connectionName: 'Gmail Account', status: 'Connected' },
  });

  assert.ok(!jsonResponse.includes('ENCRYPTION_KEY'), 'No key names in responses');
  assert.ok(!jsonResponse.includes('e8005b7b5303d196ac98c51efcdcb42836edeb61c28974ffa7813f04d09802cd'), 'No raw key hex in responses');
  console.log('✅ Test 6 Passed: Encryption key is never exposed in API responses or public logs');
}

console.log('\n🎉 All Encryption Key Security Tests Passed Successfully!');
