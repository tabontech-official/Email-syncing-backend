import crypto from "crypto";

const algorithm = "aes-256-cbc";
const key = Buffer.from(
  process.env.ENCRYPTION_KEY || "e8005b7b5303d196ac98c51efcdcb42836edeb61c28974ffa7813f04d09802cd",
  "hex"
);

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