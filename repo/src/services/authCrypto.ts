const PASSWORD_HASH_ITERATIONS = 150_000;
const PASSWORD_HASH_LENGTH_BITS = 256;
const AES_KEY_LENGTH_BITS = 256;

const textEncoder = new TextEncoder();

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function importPasswordMaterial(password: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', textEncoder.encode(password), 'PBKDF2', false, [
    'deriveBits',
    'deriveKey'
  ]);
}

export function createSalt(): string {
  const saltBytes = crypto.getRandomValues(new Uint8Array(16));
  return bytesToBase64(saltBytes);
}

export async function hashPassword(password: string, salt: string): Promise<string> {
  const passwordMaterial = await importPasswordMaterial(password);
  const saltBuffer = toArrayBuffer(base64ToBytes(salt));
  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: saltBuffer,
      iterations: PASSWORD_HASH_ITERATIONS,
      hash: 'SHA-256'
    },
    passwordMaterial,
    PASSWORD_HASH_LENGTH_BITS
  );

  return bytesToBase64(new Uint8Array(derivedBits));
}

export async function deriveEncryptionKey(password: string, salt: string): Promise<CryptoKey> {
  const passwordMaterial = await importPasswordMaterial(password);
  const saltBuffer = toArrayBuffer(base64ToBytes(salt));

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: saltBuffer,
      iterations: PASSWORD_HASH_ITERATIONS,
      hash: 'SHA-256'
    },
    passwordMaterial,
    {
      name: 'AES-GCM',
      length: AES_KEY_LENGTH_BITS
    },
    false,
    ['encrypt', 'decrypt']
  );
}

export function timingSafeEqual(left: string, right: string): boolean {
  const leftBytes = textEncoder.encode(left);
  const rightBytes = textEncoder.encode(right);

  if (leftBytes.byteLength !== rightBytes.byteLength) {
    return false;
  }

  let difference = 0;
  for (let index = 0; index < leftBytes.byteLength; index += 1) {
    difference |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }

  return difference === 0;
}

export function generateToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return bytesToBase64Url(bytes);
}

export function nowTimestamp(): number {
  return Date.now();
}
