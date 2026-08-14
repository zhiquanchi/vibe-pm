/// <reference types="@umijs/max" />

// Umi 只把 UMI_APP_ 前缀的变量注入到浏览器端（process.env.UMI_APP_*）
declare namespace NodeJS {
  interface ProcessEnv {
    readonly UMI_APP_API_BASE_URL?: string;
    readonly UMI_APP_USER_ID?: string;
  }
}
