import crypto from "crypto";

const algorithm = "aes-256-cbc";
const key = Buffer.from(process.env.ENCRYPTION_KEY, "hex");

export function encrypt(text) {
  const iv = crypto.randomBytes(16);

  const cipher = crypto.createCipheriv(
    algorithm,
    key,
    iv
  );

  const encrypted =
    Buffer.concat([
      cipher.update(text),
      cipher.final()
    ]);

  return iv.toString("hex") + ":" + encrypted.toString("hex");
}


export function decrypt(data) {

  const [iv, encrypted] = data.split(":");

  const decipher =
    crypto.createDecipheriv(
      algorithm,
      key,
      Buffer.from(iv,"hex")
    );

  return Buffer.concat([
    decipher.update(Buffer.from(encrypted,"hex")),
    decipher.final()
  ]).toString();
}