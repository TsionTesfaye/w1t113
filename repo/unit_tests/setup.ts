import { webcrypto } from 'node:crypto';

if (typeof globalThis.crypto === 'undefined') {
  Object.defineProperty(globalThis, 'crypto', {
    value: webcrypto,
    configurable: true,
    writable: true
  });
}

if (typeof globalThis.btoa === 'undefined') {
  globalThis.btoa = (value: string): string => Buffer.from(value, 'binary').toString('base64');
}

if (typeof globalThis.atob === 'undefined') {
  globalThis.atob = (value: string): string => Buffer.from(value, 'base64').toString('binary');
}
