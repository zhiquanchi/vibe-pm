/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  readonly NEXT_PUBLIC_API_BASE_URL?: string;
  readonly VITE_USER_ID?: string;
  readonly NEXT_PUBLIC_USER_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
