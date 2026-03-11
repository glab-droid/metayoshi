import cbBtcLogo from '../coins/logos/cbbtc.png'
import { createRequestCache } from './requestCache'

export type SolanaTokenRegistryEntry = {
  address: string
  symbol: string
  name: string
  decimals: number
  logoURI?: string
}

const tokenListCache = createRequestCache<Record<string, SolanaTokenRegistryEntry>>({
  defaultTtlMs: 24 * 60 * 60_000,
  maxEntries: 2
})

const SOLANA_TOKEN_REGISTRY_FALLBACK_URLS = [
  // Jupiter legacy endpoint (kept for compatibility with existing setups).
  'https://token.jup.ag/all',
  // Public static token list mirrors.
  'https://raw.githubusercontent.com/solana-labs/token-list/main/src/tokens/solana.tokenlist.json',
  'https://cdn.jsdelivr.net/gh/solana-labs/token-list@main/src/tokens/solana.tokenlist.json'
]

const STATIC_SOLANA_TOKEN_REGISTRY_ENTRIES: Record<string, SolanaTokenRegistryEntry> = {
  cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij: {
    address: 'cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij',
    symbol: 'cbBTC',
    name: 'Coinbase Wrapped BTC',
    decimals: 8,
    logoURI: cbBtcLogo
  },
  H5wjdiCbnycv7aFDPu9crV2Hr1Mve8zqprTfFLfqqqiE: {
    address: 'H5wjdiCbnycv7aFDPu9crV2Hr1Mve8zqprTfFLfqqqiE',
    symbol: 'cbBTC',
    name: 'Coinbase Wrapped BTC',
    decimals: 8,
    logoURI: cbBtcLogo
  }
}

function normalizeMint(mint: string): string {
  return String(mint || '').trim()
}

function readEnvFlag(name: string, fallback = false): boolean {
  const env = ((import.meta as any)?.env || {}) as Record<string, unknown>
  const raw = String(env?.[name] ?? '').trim().toLowerCase()
  if (!raw) return fallback
  if (['1', 'true', 'yes', 'on'].includes(raw)) return true
  if (['0', 'false', 'no', 'off'].includes(raw)) return false
  return fallback
}

function extractTokenRows(json: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(json)) return json as Array<Record<string, unknown>>
  if (json && typeof json === 'object') {
    const rows = (json as any)?.tokens
    if (Array.isArray(rows)) return rows as Array<Record<string, unknown>>
  }
  return []
}

function parseTokenRows(rows: Array<Record<string, unknown>>): Record<string, SolanaTokenRegistryEntry> {
  const out: Record<string, SolanaTokenRegistryEntry> = {}
  for (const row of rows) {
    const address = normalizeMint(String(row?.address || row?.mint || ''))
    const symbol = String(row?.symbol || '').trim()
    const name = String(row?.name || '').trim()
    const decimals = Number(row?.decimals ?? 0)
    if (!address) continue
    if (!symbol && !name) continue
    out[address] = {
      address,
      symbol: symbol || name || address.slice(0, 6),
      name: name || symbol || address.slice(0, 6),
      decimals: Number.isFinite(decimals) ? Math.max(0, Math.trunc(decimals)) : 0,
      logoURI: String((row as any)?.logoURI || (row as any)?.logoUri || '').trim() || undefined
    }
  }
  return out
}

async function fetchRegistryFromUrl(url: string): Promise<Record<string, SolanaTokenRegistryEntry>> {
  const res = await fetch(url, { method: 'GET' })
  if (!res.ok) throw new Error(`Failed to fetch Solana token registry (${res.status}) from ${url}`)
  const json = await res.json()
  return parseTokenRows(extractTokenRows(json))
}

export async function getSolanaTokenRegistry(): Promise<Record<string, SolanaTokenRegistryEntry>> {
  return await tokenListCache.get('solana-token-registry:jupiter', async () => {
    const env = ((import.meta as any)?.env || {}) as Record<string, unknown>
    const configuredUrl = String(env?.VITE_SOL_TOKEN_REGISTRY_URL || '').trim()
    const allowPublicRegistry = readEnvFlag('VITE_SOL_ALLOW_PUBLIC_TOKEN_REGISTRY', false)
    // Default behavior: no external token-registry call unless explicitly allowed/configured.
    if (!configuredUrl && !allowPublicRegistry) return { ...STATIC_SOLANA_TOKEN_REGISTRY_ENTRIES }

    const urls = configuredUrl
      ? [configuredUrl, ...SOLANA_TOKEN_REGISTRY_FALLBACK_URLS.filter((u) => u !== configuredUrl)]
      : [...SOLANA_TOKEN_REGISTRY_FALLBACK_URLS]

    let lastError: unknown = null
    for (const url of urls) {
      try {
        const out = await fetchRegistryFromUrl(url)
        if (Object.keys(out).length > 0) {
          return {
            ...STATIC_SOLANA_TOKEN_REGISTRY_ENTRIES,
            ...out
          }
        }
      } catch (error) {
        lastError = error
      }
    }
    if (lastError) throw lastError
    return { ...STATIC_SOLANA_TOKEN_REGISTRY_ENTRIES }
  }).catch(() => ({ ...STATIC_SOLANA_TOKEN_REGISTRY_ENTRIES }))
}

