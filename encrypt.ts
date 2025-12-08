const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * Generate a new AES‑GCM key.
 */
async function generateAesGcmKey() {
  const key = await crypto.subtle.generateKey(
    {
      name: "AES-GCM",
      length: 256,
    },
    true,
    ["encrypt", "decrypt"],
  );

  return key;
}

export async function encryptStringAesGcm(plaintext: string) {
  const key = await generateAesGcmKey();

  const iv = crypto.getRandomValues(new Uint8Array(12));

  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv,
    },
    key,
    encoder.encode(plaintext),
  );

  return { key, iv, ciphertext };
}

export async function decryptStringAesGcm(
  ciphertext: BufferSource,
  key: CryptoKey,
  iv: BufferSource,
) {
  const plaintextBuffer = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv,
    },
    key,
    ciphertext,
  );

  return decoder.decode(plaintextBuffer);
}

export function arrayBufferToBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}
