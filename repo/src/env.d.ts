/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_AUTH_SEED_DEFAULT_ADMIN?: string;
  readonly VITE_VERBOSE_LOGS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
