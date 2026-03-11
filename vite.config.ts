import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import wasm from 'vite-plugin-wasm'
import topLevelAwait from 'vite-plugin-top-level-await'
import path from 'path'
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8')) as { version: string }

type BuildConfig = {
  coins?: { enabled?: 'all' | '*' | string[]; disabled?: string[] }
  features?: Record<string, boolean | undefined>
  modelStatus?: { tested?: string[]; untested?: string[]; blocked?: string[] }
}

type WalletLogoSpec = {
  coinIds: string[]
  file: string
  names: string[]
}

function loadBuildConfig(): BuildConfig {
  const explicit = String(process.env.METAYOSHI_BUILD_CONFIG_PATH || '').trim()
  const defaultPath = path.resolve(__dirname, 'metayoshi.build.json')
  const configPath = explicit ? path.resolve(__dirname, explicit) : defaultPath
  if (!existsSync(configPath)) return {}

  try {
    const raw = readFileSync(configPath, 'utf-8')
    const json = JSON.parse(raw) as any
    if (!json || typeof json !== 'object' || Array.isArray(json)) return {}
    console.log(`[metayoshi] Build config loaded from ${configPath}`)
    return json as BuildConfig
  } catch (err) {
    console.warn(`[metayoshi] Failed to load build config from ${configPath}:`, err)
    return {}
  }
}

const buildConfig = loadBuildConfig()

const VIRTUAL_WALLET_LOGO_REGISTRY_ID = 'virtual:wallet-logo-registry'
const RESOLVED_VIRTUAL_WALLET_LOGO_REGISTRY_ID = `\0${VIRTUAL_WALLET_LOGO_REGISTRY_ID}`

const WALLET_LOGO_SPECS: WalletLogoSpec[] = [
  { coinIds: ['rtm'], file: 'raptoreum.png', names: ['raptoreum', 'rtm'] },
  { coinIds: ['eth'], file: 'ethereum.png', names: ['ethereum', 'eth'] },
  { coinIds: ['arb'], file: 'arbitrum.png', names: ['arbitrum', 'arb', 'arbitrum-one'] },
  { coinIds: ['op'], file: 'op.png', names: ['op', 'optimism'] },
  { coinIds: ['base'], file: 'base.png', names: ['base', 'base-mainnet', 'base-chain'] },
  { coinIds: ['bnb', 'bnb-testnet'], file: 'bnb.png', names: ['bnb', 'bsc', 'bnb-smart-chain', 'binance-smart-chain'] },
  { coinIds: ['avaxc'], file: 'avalanche.png', names: ['avalanche', 'avax', 'avaxc', 'avalanche-c-chain'] },
  { coinIds: ['sol'], file: 'solana.png', names: ['solana', 'sol'] },
  { coinIds: ['dash'], file: 'dash.png', names: ['dash'] },
  { coinIds: ['doge'], file: 'dogecoin.png', names: ['dogecoin', 'doge'] },
  { coinIds: ['tron', 'trx'], file: 'tron.png', names: ['tron', 'trx'] },
  { coinIds: ['ada', 'cardano'], file: 'cardano.png', names: ['cardano', 'ada'] },
  { coinIds: ['xlm', 'stellar'], file: 'stellar.png', names: ['stellar', 'xlm'] },
  { coinIds: ['btcz'], file: 'bitcoinz.png', names: ['bitcoinz', 'btcz'] },
  { coinIds: ['firo'], file: 'firo.png', names: ['firo'] },
  { coinIds: ['cosmos'], file: 'cosmos.png', names: ['cosmos', 'atom'] },
  { coinIds: ['bitcoin'], file: 'bitcoin.png', names: ['bitcoin', 'btc'] },
  { coinIds: ['polygon'], file: 'polygon.png', names: ['polygon', 'matic'] },
  { coinIds: ['cronos', 'cro'], file: 'cronos.png', names: ['cronos', 'cro', 'cronos-pos'] },
  { coinIds: ['sui'], file: 'sui.png', names: ['sui'] },
  { coinIds: ['zksync'], file: 'ZKsync.png', names: ['zksync', 'zk-sync', 'zk sync', 'zks', 'zk', 'zk era', 'zksync-era'] }
]

function normalizeCoinId(value: unknown): string {
  return String(value ?? '').trim().toLowerCase()
}

function resolveBundledWalletLogoSpecs(config: BuildConfig): WalletLogoSpec[] {
  const disabled = new Set((config.coins?.disabled || []).map(normalizeCoinId).filter(Boolean))
  // Network logo assets must stay available even when the visible network set is
  // restricted by build config. The app can still surface runtime/server-backed
  // EVM variants, and missing bundled logos regress to placeholders.
  return WALLET_LOGO_SPECS.filter((spec) => spec.coinIds.some((id) => !disabled.has(normalizeCoinId(id))))
}

function createWalletLogoRegistryModule(config: BuildConfig): string {
  const specs = resolveBundledWalletLogoSpecs(config)
  const imports = specs.map((spec, index) => {
    const from = `/src/coins/logos/${spec.file}`
    return `import logo${index} from ${JSON.stringify(from)}`
  })
  const entries = specs.map((spec, index) => {
    return `  { src: logo${index}, names: ${JSON.stringify(spec.names)} }`
  })

  return [
    ...imports,
    '',
    'export const bundledWalletLogos = [',
    ...entries.map((entry, index) => `${entry}${index < entries.length - 1 ? ',' : ''}`),
    ']'
  ].join('\n')
}

function parseBooleanLike(value: unknown, fallback: boolean): boolean {
  const normalized = String(value ?? '').trim().toLowerCase()
  if (!normalized) return fallback
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false
  return fallback
}

function stripInlineComment(value: string): string {
  let out = ''
  let quote: '"' | "'" | null = null
  for (let i = 0; i < value.length; i += 1) {
    const ch = value[i]
    if (ch === '"' || ch === "'") {
      if (!quote) quote = ch
      else if (quote === ch) quote = null
      out += ch
      continue
    }
    if (ch === '#' && !quote) break
    out += ch
  }
  return out.trim()
}

function unquote(value: string): string {
  const trimmed = value.trim()
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
    || (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

function parseEnvFile(filePath: string): Record<string, string> {
  const out: Record<string, string> = {}
  if (!existsSync(filePath)) return out

  const raw = readFileSync(filePath, 'utf-8')
  const lines = raw.split(/\r?\n/)
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue

    const equalsPos = trimmed.indexOf('=')
    if (equalsPos <= 0) continue

    const key = trimmed.slice(0, equalsPos).trim()
    const rawValue = trimmed.slice(equalsPos + 1)
    const value = unquote(stripInlineComment(rawValue))
    if (!key) continue
    out[key] = value
  }

  return out
}

function setProcessEnvIfMissing(key: string, value: unknown): void {
  const current = String(process.env[key] ?? '').trim()
  if (current) return
  const normalized = String(value ?? '').trim()
  if (!normalized) return
  process.env[key] = normalized
}

function loadBridgeEnvFromSiblingServerRepo(): void {
  // Local developer convenience:
  // Pull bridge env context from sibling metayoshi_SERVER env file.
  // Never map shared bridge secrets into VITE_* because those values are
  // bundled into the extension and extractable from release artifacts.
  const enabled = parseBooleanLike(
    process.env.BRIDGE_AUTOCONFIG_FROM_SERVER_ENV
      ?? process.env.VITE_BRIDGE_AUTOCONFIG_FROM_SERVER_ENV,
    false
  )
  if (!enabled) return

  const candidateFiles = [
    path.resolve(__dirname, '../metayoshi_SERVER/windows/local/.env.windows'),
    path.resolve(__dirname, '../metayoshi_SERVER/windows/local/.env'),
    path.resolve(__dirname, '../metayoshi_SERVER/windows/vultr/.env'),
    path.resolve(__dirname, '../metayoshi_SERVER/docker/local/.env.windows'),
    path.resolve(__dirname, '../metayoshi_SERVER/docker/local/.env'),
    path.resolve(__dirname, '../metayoshi_SERVER/docker/vultr/.env'),
    path.resolve(__dirname, '../metayoshi_SERVER/.env')
  ]

  let selectedFile = ''
  let sourceEnv: Record<string, string> = {}
  for (const file of candidateFiles) {
    if (!existsSync(file)) continue
    const parsed = parseEnvFile(file)
    if (Object.keys(parsed).length === 0) continue
    selectedFile = file
    sourceEnv = parsed
    break
  }
  if (!selectedFile) return

  // Do not import BRIDGE_BASIC_USER / BRIDGE_BASIC_PASSWORD / BRIDGE_TX_AUTH_KEY
  // into the client bundle.
  const secureApiBase = sourceEnv.SECURE_BRIDGE_API_BASE_URL || sourceEnv.API_BASE_URL
  setProcessEnvIfMissing('VITE_SECURE_BRIDGE_API_BASE_URL', secureApiBase)

  console.log(`[metayoshi] Bridge env auto-config loaded from ${selectedFile} (secrets ignored)`)
}

loadBridgeEnvFromSiblingServerRepo()

// https://vitejs.dev/config/
export default defineConfig({
  base: '/',
  plugins: [
    wasm(),
    topLevelAwait(),
    react(),
    {
      name: 'wallet-logo-registry',
      resolveId(id) {
        if (id === VIRTUAL_WALLET_LOGO_REGISTRY_ID) return RESOLVED_VIRTUAL_WALLET_LOGO_REGISTRY_ID
        return null
      },
      load(id) {
        if (id !== RESOLVED_VIRTUAL_WALLET_LOGO_REGISTRY_ID) return null
        return createWalletLogoRegistryModule(buildConfig)
      }
    },
    {
      name: 'post-build-extension',
      closeBundle() {
        // Ensure dist/assets exists
        const assetsDir = path.resolve(__dirname, 'dist/assets')
        if (!existsSync(assetsDir)) {
          mkdirSync(assetsDir, { recursive: true })
        }

        // Copy manifest.json
        try {
          copyFileSync('public/manifest.json', 'dist/manifest.json')
          console.log('[OK] Copied manifest.json to dist/')
        } catch (err) {
          console.error('Failed to copy manifest.json:', err)
        }

        // Copy MetayoshiLogo.png to dist root (used by logo + favicon)
        try {
          const logoSrc = path.resolve(__dirname, 'public/MetayoshiLogo.png')
          const logoDest = path.resolve(__dirname, 'dist/MetayoshiLogo.png')
          if (existsSync(logoSrc)) {
            copyFileSync(logoSrc, logoDest)
            console.log('Copied MetayoshiLogo.png to dist/')
          } else {
            console.warn('MISSING: public/MetayoshiLogo.png')
          }
        } catch (err) {
          console.error('Failed to copy MetayoshiLogo.png:', err)
        }

        // Copy icons: public/icons/icon-*.png -> dist/assets/metayoshi-*.png
        try {
          const publicIconsDir = path.resolve(__dirname, 'public/icons')
          if (existsSync(publicIconsDir)) {
            const distIconsDir = path.resolve(__dirname, 'dist/icons')
            if (!existsSync(distIconsDir)) {
              mkdirSync(distIconsDir, { recursive: true })
            }
            const iconMapping: Record<string, string> = {
              'icon-16.png':  'metayoshi-16.png',
              'icon-32.png':  'metayoshi-32.png',
              'icon-48.png':  'metayoshi-48.png',
              'icon-64.png':  'metayoshi-64.png',
              'icon-128.png': 'metayoshi-128.png',
            }
            for (const [src, dest] of Object.entries(iconMapping)) {
              const srcPath  = path.join(publicIconsDir, src)
              const destPath = path.join(assetsDir, dest)
              const legacyDestPath = path.join(distIconsDir, src)
              if (existsSync(srcPath)) {
                copyFileSync(srcPath, destPath)
                console.log(`[OK] Copied ${src} -> dist/assets/${dest}`)
                copyFileSync(srcPath, legacyDestPath)
                console.log(`[OK] Copied ${src} -> dist/icons/${src}`)
              }
            }
          }
        } catch (err) {
          console.error('Failed to copy icons:', err)
        }

        // Rename bootstrap.css -> ui.css (Vite names CSS after the chunk that imports it)
        try {
          const bootstrapCss = path.resolve(__dirname, 'dist/assets/bootstrap.css')
          const uiCss = path.resolve(__dirname, 'dist/assets/ui.css')
          if (existsSync(bootstrapCss) && !existsSync(uiCss)) {
            copyFileSync(bootstrapCss, uiCss)
            console.log('[OK] Renamed bootstrap.css -> ui.css')
          }
        } catch (err) {
          console.error('Failed to rename CSS:', err)
        }

        // Fix popup HTML: ensure script/link tags use /assets/ui.js and /assets/ui.css
        try {
          const htmlPath = path.resolve(__dirname, 'dist/app/src/ui/index.html')
          if (existsSync(htmlPath)) {
            let html = readFileSync(htmlPath, 'utf-8')

            // Remove the dev-only script tag pointing to /src/main.tsx (Vite injects the real one)
            html = html.replace(/<script[^>]*src="\/src\/main\.tsx"[^>]*><\/script>\n?\s*/g, '')

            // Normalise any auto-generated asset paths -> absolute /assets/...
            html = html.replace(/src="\.+\/assets\//g, 'src="/assets/')
            html = html.replace(/href="\.+\/assets\//g, 'href="/assets/')

            // Fix any bootstrap.css reference -> ui.css
            html = html.replace(/bootstrap\.css/g, 'ui.css')

            // Ensure script tag is present
            if (!html.includes('/assets/ui.js')) {
              html = html.replace(
                '</head>',
                '    <script type="module" crossorigin src="/assets/ui.js"></script>\n  </head>',
              )
            }

            // Ensure CSS link tag is present
            if (!html.includes('/assets/ui.css')) {
              html = html.replace(
                '</head>',
                '    <link rel="stylesheet" crossorigin href="/assets/ui.css">\n  </head>',
              )
            }

            writeFileSync(htmlPath, html, 'utf-8')
            console.log('[OK] Fixed popup HTML asset paths')
          } else {
            console.warn('[WARN] dist/app/src/ui/index.html not found after build')
          }
        } catch (err) {
          console.error('Failed to fix popup HTML:', err)
        }

        // Sanity-check critical files
        for (const f of ['dist/background.js', 'dist/assets/ui.js', 'dist/assets/ui.css']) {
          const p = path.resolve(__dirname, f)
          if (existsSync(p)) {
            console.log(`[OK] ${f}`)
          } else {
            console.warn(`[WARN] MISSING: ${f}`)
          }
        }
      }
    }
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // Polyfill Node's 'buffer' package for the browser bundle
      buffer: 'buffer',
      // Polyfill Node core modules pulled by crypto helper deps.
      stream: 'stream-browserify',
      events: 'events',
      process: 'process/browser',
    },
  },
  // Make Buffer available as a global so libraries that reference it directly work
  define: {
    global: 'globalThis',
    process: 'globalThis.process',
    'globalThis.Buffer': 'globalThis.Buffer',
    'import.meta.env.VITE_APP_VERSION': JSON.stringify(pkg.version),
    __METAYOSHI_BUILD_CONFIG__: JSON.stringify(buildConfig ?? {}),
  },
  optimizeDeps: {
    include: ['buffer', 'stream-browserify', 'events', 'process'],
  },
  build: {
    rollupOptions: {
      onwarn(warning, warn) {
        const message = String((warning as any)?.message ?? '')
        const id = String((warning as any)?.id ?? (warning as any)?.loc?.file ?? '')

        // Rollup (via Vite) sometimes emits a benign warning for misplaced `/*#__PURE__*/`
        // annotations in certain `ox` versions bundled under WalletConnect/Reown deps.
        // The warning already states Rollup will remove the comment; build output is otherwise correct.
        if (
          (message.includes('contains an annotation that Rollup cannot interpret')
            || message.includes('Rollup cannot interpret due to the position of the comment'))
          && (message.includes('ox/_esm/core/Base64.js') || id.includes('ox/_esm/core/Base64.js'))
        ) {
          return
        }

        warn(warning)
      },
      input: {
        ui:         path.resolve(__dirname, 'app/src/ui/index.html'),
        background: path.resolve(__dirname, 'src/background/service-worker.ts'),
        content:    path.resolve(__dirname, 'src/content/content-script.ts'),
        inpage:     path.resolve(__dirname, 'src/inpage/inpage-provider.ts'),
      },
      output: {
        entryFileNames: (chunkInfo) => {
          if (chunkInfo.name === 'background') return 'background.js'
          return 'assets/[name].js'
        },
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: (assetInfo) => {
          if (assetInfo.name === 'manifest.json') return 'manifest.json'
          return 'assets/[name][extname]'
        },
      },
    },
    outDir: 'dist',
    emptyOutDir: true,
    copyPublicDir: false,
    sourcemap: false,
    modulePreload: false,
    minify: 'esbuild',
    target: ['chrome79', 'firefox78'],
  },
  publicDir: 'public',
})
