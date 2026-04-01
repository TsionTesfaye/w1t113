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

if (typeof globalThis.CustomEvent === 'undefined') {
  const EventBase = (globalThis.Event ??
    class {
      type: string;

      constructor(type: string) {
        this.type = type;
      }
    }) as unknown as typeof Event;

  class NodeCustomEvent<T = unknown> extends EventBase {
    detail: T;

    constructor(type: string, options?: { detail?: T } & EventInit) {
      super(type, options);
      this.detail = options?.detail as T;
    }
  }

  Object.defineProperty(globalThis, 'CustomEvent', {
    value: NodeCustomEvent,
    configurable: true,
    writable: true
  });
}
