interface ImportMetaEnv {
  /** Where the relay is, from .env.development or .env.production. */
  readonly VITE_ONLINE_SERVER: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
