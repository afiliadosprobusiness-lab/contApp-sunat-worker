import crypto from "crypto";

const getKey = () => {
  const keyRaw = process.env.SUNAT_ENCRYPTION_KEY;
  if (!keyRaw) {
    throw new Error("Missing SUNAT_ENCRYPTION_KEY");
  }

  const key = Buffer.from(keyRaw, "base64");
  if (key.length !== 32) {
    throw new Error("SUNAT_ENCRYPTION_KEY must be 32 bytes base64");
  }
  return key;
};

export const encryptPayload = (payload) => {
  const key = getKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const json = JSON.stringify(payload);
  const encrypted = Buffer.concat([cipher.update(json, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    data: encrypted.toString("base64"),
  };
};

export const decryptPayload = (payload) => {
  const key = getKey();
  const iv = Buffer.from(payload.iv, "base64");
  const tag = Buffer.from(payload.tag, "base64");
  const data = Buffer.from(payload.data, "base64");

  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);

  const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
  return JSON.parse(decrypted.toString("utf8"));
};
