const ROTATION_TAG = 'metayoshi-bridge-tx-v1'
const BRIDGE_AUTH_STORAGE_KEY = 'metayoshi-bridge-tx-auth-v1'
const DEFAULT_ROTATE_BY_DATE = true
const DEFAULT_ACCEPT_SKEW_DAYS = 1

type BridgeTxAuthConfig = {
  secret?: string
  rotateByDate?: boolean
}

export type { BridgeTxAuthConfig }

let runtimeConfigLoaded = false
let runtimeConfigCache: BridgeTxAuthConfig = {}

function utcDateStamp(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function addUtcDays(date: Date, days: number): Date {
  const next = new Date(date.getTime())
  next.setUTCDate(next.getUTCDate() + days)
  return next
}

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input)
  const hashBuffer = await crypto.subtle.digest('SHA-256', bytes)
  const hash = new Uint8Array(hashBuffer)
  return Array.from(hash, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function normalizeBridgeTxAuthConfig(value: unknown): BridgeTxAuthConfig {
  if (!value || typeof value !== 'object') return {}
  const raw = value as Record<string, unknown>
  const secret = String(raw.secret ?? '').trim()
  const rotateByDate = typeof raw.rotateByDate === 'boolean'
    ? raw.rotateByDate
    : DEFAULT_ROTATE_BY_DATE
  return secret ? { secret, rotateByDate } : {}
}

function normalizeSecret(value: unknown): string {
  return String(value ?? '').trim()
}

function canUseChromeStorage(): boolean {
  return typeof chrome !== 'undefined' && Boolean(chrome.storage?.local)
}

async function readFromChromeStorage(): Promise<BridgeTxAuthConfig | null> {
  if (!canUseChromeStorage()) return null
  try {
    const stored = await chrome.storage.local.get(BRIDGE_AUTH_STORAGE_KEY)
    return normalizeBridgeTxAuthConfig(stored?.[BRIDGE_AUTH_STORAGE_KEY])
  } catch {
    return null
  }
}

function canUseLocalStorage(): boolean {
  try {
    return typeof localStorage !== 'undefined'
  } catch {
    return false
  }
}

function readFromLocalStorage(): BridgeTxAuthConfig | null {
  if (!canUseLocalStorage()) return null
  try {
    const raw = localStorage.getItem(BRIDGE_AUTH_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as unknown
    return normalizeBridgeTxAuthConfig(parsed)
  } catch {
    return null
  }
}

async function getRuntimeBridgeTxAuthConfig(): Promise<BridgeTxAuthConfig> {
  if (runtimeConfigLoaded) return runtimeConfigCache

  const chromeConfig = await readFromChromeStorage()
  if (chromeConfig && chromeConfig.secret) {
    runtimeConfigCache = chromeConfig
    runtimeConfigLoaded = true
    return runtimeConfigCache
  }

  const localConfig = readFromLocalStorage()
  runtimeConfigCache = localConfig ?? {}
  runtimeConfigLoaded = true
  return runtimeConfigCache
}

async function persistBridgeTxAuthConfig(config: BridgeTxAuthConfig): Promise<void> {
  if (canUseChromeStorage()) {
    try {
      await chrome.storage.local.set({ [BRIDGE_AUTH_STORAGE_KEY]: config })
    } catch {
      // ignore storage errors and keep in-memory config
    }
  }

  if (canUseLocalStorage()) {
    try {
      if (config.secret) {
        localStorage.setItem(BRIDGE_AUTH_STORAGE_KEY, JSON.stringify(config))
      } else {
        localStorage.removeItem(BRIDGE_AUTH_STORAGE_KEY)
      }
    } catch {
      // ignore storage errors and keep in-memory config
    }
  }
}

export async function setBridgeTxAuthConfig(config: BridgeTxAuthConfig): Promise<void> {
  runtimeConfigCache = normalizeBridgeTxAuthConfig(config)
  runtimeConfigLoaded = true
  await persistBridgeTxAuthConfig(runtimeConfigCache)
}

export async function clearBridgeTxAuthConfig(): Promise<void> {
  runtimeConfigCache = {}
  runtimeConfigLoaded = true
  await persistBridgeTxAuthConfig(runtimeConfigCache)
}

export async function getBridgeTxAuthConfig(): Promise<BridgeTxAuthConfig> {
  const config = await getRuntimeBridgeTxAuthConfig()
  return {
    secret: config.secret ?? '',
    rotateByDate: typeof config.rotateByDate === 'boolean'
      ? config.rotateByDate
      : DEFAULT_ROTATE_BY_DATE
  }
}

export async function resolveBridgeTxKey(): Promise<string | undefined> {
  const keys = await resolveBridgeTxKeyCandidates()
  return keys[0]
}

export async function resolveBridgeTxKeyCandidates(
  options: { fallbackSecret?: string } = {}
): Promise<string[]> {
  const config = await getRuntimeBridgeTxAuthConfig()
  const primarySecret = normalizeSecret(config.secret)
  const fallbackSecret = normalizeSecret(options.fallbackSecret)
  const secrets = Array.from(new Set([primarySecret, fallbackSecret].filter(Boolean)))
  if (secrets.length === 0) return []

  const rotateByDate = config.rotateByDate !== false
  const skewDaysRaw = Number(import.meta.env.VITE_BRIDGE_TX_AUTH_ACCEPT_SKEW_DAYS ?? DEFAULT_ACCEPT_SKEW_DAYS)
  const skewDays = Number.isFinite(skewDaysRaw)
    ? Math.max(0, Math.min(7, Math.trunc(skewDaysRaw)))
    : DEFAULT_ACCEPT_SKEW_DAYS

  const now = new Date()
  const out: string[] = []

  for (const secret of secrets) {
    if (!rotateByDate) {
      out.push(secret)
    }

    for (let offset = -skewDays; offset <= skewDays; offset += 1) {
      const stamp = utcDateStamp(addUtcDays(now, offset))
      const derived = await sha256Hex(`${ROTATION_TAG}|${stamp}|${secret}`)
      out.push(derived)
    }

    if (rotateByDate) {
      // Fallback if server rotation is disabled but client assumes rotation.
      out.push(secret)
    }
  }

  return Array.from(new Set(out.filter(Boolean)))
}
