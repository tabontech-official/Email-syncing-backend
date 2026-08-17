import crypto from "crypto";

const algorithm = "aes-256-cbc";

/**
 * Resolves and validates the 32-byte AES-256 encryption key from process.env.ENCRYPTION_KEY
 */
export function getEncryptionKey(overrideEnvKey, overrideNodeEnv) {
  const envKey = overrideEnvKey !== undefined ? overrideEnvKey : process.env.ENCRYPTION_KEY;
  const nodeEnv = overrideNodeEnv !== undefined ? overrideNodeEnv : process.env.NODE_ENV;

  if (!envKey || !envKey.trim()) {
    if (nodeEnv === "production") {
      throw new Error(
        "FATAL SECURITY CONFIGURATION ERROR: ENCRYPTION_KEY environment variable is missing in production!"
      );
    }
    // Safe development/testing fallback key when not running in production
    return Buffer.from("e8005b7b5303d196ac98c51efcdcb42836edeb61c28974ffa7813f04d09802cd", "hex");
  }

  const trimmed = envKey.trim();
  if (trimmed.length === 64) {
    return Buffer.from(trimmed, "hex");
  }
  if (trimmed.length === 32) {
    return Buffer.from(trimmed, "utf8");
  }

  // Derive 32-byte key via SHA-256 if key is an arbitrary length string
  return crypto.createHash("sha256").update(trimmed).digest();
}

const key = getEncryptionKey();

export function encrypt(text) {
  if (!text) return "";
  const iv = crypto.randomBytes(16);

  const cipher = crypto.createCipheriv(algorithm, key, iv);

  const encrypted = Buffer.concat([cipher.update(text), cipher.final()]);

  return iv.toString("hex") + ":" + encrypted.toString("hex");
}

export function decrypt(data) {
  if (!data || typeof data !== "string") return data || "";
  const trimmed = data.trim();

  // If text does not contain colon delimiter (:), it is unencrypted raw string
  if (!trimmed.includes(":")) {
    return trimmed;
  }

  try {
    const parts = trimmed.split(":");
    if (parts.length !== 2) return trimmed;

    const [ivHex, encryptedHex] = parts;
    const iv = Buffer.from(ivHex, "hex");
    const encrypted = Buffer.from(encryptedHex, "hex");

    if (iv.length !== 16) return trimmed;

    const decipher = crypto.createDecipheriv(algorithm, key, iv);

    const decrypted = Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]).toString("utf8");

    return decrypted;
  } catch (err) {
    console.warn("⚠️ [decrypt] Decryption failed, using fallback:", err.message);
    return trimmed;
  }
}