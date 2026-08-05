function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function fromHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

async function pbkdf2(
  password: string,
  salt: Uint8Array,
  iterations = 120_000,
): Promise<ArrayBuffer> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  return crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      // BufferSource typing across DOM libs can reject Uint8Array generically
      salt: salt as BufferSource,
      iterations,
      hash: "SHA-256",
    },
    key,
    256,
  );
}

/** Returns `iterations$saltHex$hashHex` */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iterations = 120_000;
  const bits = await pbkdf2(password, salt, iterations);
  return `${iterations}$${toHex(salt.buffer)}$${toHex(bits)}`;
}

export async function verifyPassword(
  password: string,
  encoded: string,
): Promise<boolean> {
  const [iterStr, saltHex, hashHex] = encoded.split("$");
  if (!iterStr || !saltHex || !hashHex) return false;
  const iterations = Number(iterStr);
  if (!Number.isFinite(iterations) || iterations < 10_000) return false;
  const salt = fromHex(saltHex);
  const bits = await pbkdf2(password, salt, iterations);
  const candidate = toHex(bits);
  if (candidate.length !== hashHex.length) return false;
  // constant-ish compare
  let diff = 0;
  for (let i = 0; i < candidate.length; i++) {
    diff |= candidate.charCodeAt(i) ^ hashHex.charCodeAt(i);
  }
  return diff === 0;
}
