/// <reference types="vite/client" />

declare const __METAYOSHI_BUILD_CONFIG__: import('./buildConfig').BuildConfig | undefined

declare module 'virtual:wallet-logo-registry' {
  export const bundledWalletLogos: Array<{ src: string; names: string[] }>
}

