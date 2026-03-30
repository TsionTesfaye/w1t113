export interface PasswordHashResult {
  passwordHash: string;
  passwordSalt: string;
}

export interface EncryptionPayload {
  ciphertext: string;
  iv: string;
}

export interface CryptoService {
  hashPassword(password: string, salt?: string): Promise<PasswordHashResult>;
  verifyPassword(password: string, expectedHash: string, salt: string): Promise<boolean>;
  encryptSensitive(payload: string, password: string): Promise<EncryptionPayload>;
  decryptSensitive(payload: EncryptionPayload, password: string): Promise<string>;
}
