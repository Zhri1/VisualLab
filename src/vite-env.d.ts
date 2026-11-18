/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "false" 时改用真实识别接口 */
  readonly VITE_USE_MOCK_API?: string;
  /** 识别服务根地址，留空则走同源（配合 vite proxy） */
  readonly VITE_API_BASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
