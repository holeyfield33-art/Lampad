/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Endpoint that queued SOS packets are POSTed to (see .env.example). */
  readonly VITE_SOS_ENDPOINT?: string;
  /** Base URL for backend webhooks (see .env.example). */
  readonly VITE_BACKEND_WEBHOOK_BASE?: string;
  /** Base URL of the knowledge-pack hub (see .env.example). */
  readonly VITE_BUNDLE_HUB?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
