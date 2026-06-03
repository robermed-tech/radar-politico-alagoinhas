/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SCRIPT_URL: string;
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_KEY: string;
  readonly VITE_TENANT: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
