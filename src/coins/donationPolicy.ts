import type { Network } from './types'

export const DONATION_ENABLED_DEFAULT = true
export const DONATION_PERCENT_DEFAULT = 0.5

// Safe app-level fallback used when bridge donation policy is unavailable and env is unset.
const RTM_DONATION_ADDRESS_DEFAULT = 'RTRcdtm5uvFn7iQjLmEQvvcvJhKDzNsfAf'
// Optional app fallbacks for non-RTM donation-enabled coins.
const DOGE_DONATION_ADDRESS_DEFAULT = ''
const FIRO_DONATION_ADDRESS_DEFAULT = 'aPkbNkmpaWieJ22xdeaUh7vJnPT5stjJjC'

export interface CoinDonationPolicy {
  enabled: boolean
  required: boolean
  percent: number
  address: string
  source: 'bridge' | 'env'
}

function parseBool(value: unknown): boolean {
  const normalized = String(value ?? '').trim().toLowerCase()
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on'
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0
  return Math.min(100, Number(value.toFixed(4)))
}

function buildAuthHeader(network: Network): Record<string, string> {
  if (!network.bridgeUsername || !network.bridgePassword) return {}
  return {
    Authorization: `Basic ${btoa(`${network.bridgeUsername}:${network.bridgePassword}`)}`
  }
}

function extractApiBase(network: Network): string {
  const bridgeUrl = String(network.bridgeUrl || '').trim().replace(/\/+$/, '')
  if (bridgeUrl) {
    const idx = bridgeUrl.indexOf('/v1/bridge')
    if (idx >= 0) return bridgeUrl.slice(0, idx)
    return bridgeUrl
  }
  return String(network.rpcUrl || '').trim().replace(/\/+$/, '')
}

function parsePolicyPayload(payload: any): Omit<CoinDonationPolicy, 'source'> | null {
  const root = payload?.donation ?? payload?.policy?.donation ?? payload?.policy ?? payload
  if (!root || typeof root !== 'object') return null

  const address = String(
    root.address
    ?? root.donationAddress
    ?? root.creatorDonationAddress
    ?? root.toAddress
    ?? ''
  ).trim()
  const percent = clampPercent(Number(
    root.percent
    ?? root.donationPercent
    ?? root.pct
    ?? root.feePercent
    ?? root.donation_fee_pct
    ?? DONATION_PERCENT_DEFAULT
  ))
  const required = parseBool(root.required ?? root.enforced ?? root.forceDonation)
  const enabled = parseBool(root.enabled ?? true)

  if (!address || percent <= 0) return null
  return { address, percent, required, enabled }
}

async function fetchJson(url: string, headers: Record<string, string>): Promise<any | null> {
  try {
    const res = await fetch(url, { method: 'GET', headers })
    if (!res.ok) return null
    return await res.json().catch(() => null)
  } catch {
    return null
  }
}

const policyCache = new Map<string, { ts: number; value: CoinDonationPolicy | null }>()
const CACHE_TTL_MS = 60_000

const DONATION_COIN_ID_BY_NETWORK_ID: Record<string, string> = {
  rtm: 'raptoreum',
  doge: 'dogecoin',
  firo: 'firo',
  arr: 'arr'
}

function resolveDonationCoinId(network: Network): string {
  return DONATION_COIN_ID_BY_NETWORK_ID[String(network.id || '').trim()] || ''
}

function resolveDonationEnvPrefix(network: Network): string {
  const id = String(network.id || '').trim().toUpperCase()
  if (!id) return ''
  if (id === 'DOGE') return 'DOGE'
  if (id === 'RTM') return 'RTM'
  return id
}

function resolveDonationAddressDefault(prefix: string): string {
  if (prefix === 'RTM') return RTM_DONATION_ADDRESS_DEFAULT
  if (prefix === 'DOGE') return DOGE_DONATION_ADDRESS_DEFAULT
  if (prefix === 'FIRO') return FIRO_DONATION_ADDRESS_DEFAULT
  return ''
}

export function supportsCoinDonationPolicy(network: Network): boolean {
  return Boolean(resolveDonationCoinId(network))
}

function readDonationPolicyFromEnv(network: Network): CoinDonationPolicy | null {
  const prefix = resolveDonationEnvPrefix(network)
  if (!prefix) return null
  const configuredAddress = String((import.meta.env as any)[`VITE_${prefix}_DONATION_ADDRESS`] || '').trim()
  const fallbackAddress = configuredAddress || resolveDonationAddressDefault(prefix)
  const envPercent = clampPercent(Number((import.meta.env as any)[`VITE_${prefix}_DONATION_PERCENT`] || DONATION_PERCENT_DEFAULT))
  if (!fallbackAddress || envPercent <= 0) return null
  return {
    address: fallbackAddress,
    percent: envPercent,
    required: parseBool((import.meta.env as any)[`VITE_${prefix}_DONATION_REQUIRED`] || false),
    enabled: true,
    source: 'env'
  }
}

export async function fetchCoinDonationPolicy(network: Network): Promise<CoinDonationPolicy | null> {
  const coinId = resolveDonationCoinId(network)
  if (!coinId) return null
  const cacheKey = `${network.id}:${network.bridgeUrl || network.rpcUrl}`
  const now = Date.now()
  const cached = policyCache.get(cacheKey)
  if (cached && now - cached.ts < CACHE_TTL_MS) return cached.value

  const headers = buildAuthHeader(network)
  const base = extractApiBase(network)
  const bridgeUrl = String(network.bridgeUrl || '').trim().replace(/\/+$/, '')
  const candidates = [
    base ? `${base}/donation` : '',
    base ? `${base}/v1/bridge/donation/${coinId}/main` : '',
    base ? `${base}/v1/bridge/config/donation/${coinId}/main` : '',
    base ? `${base}/v1/bridge/policy/${coinId}/main` : '',
    bridgeUrl ? `${bridgeUrl}/donation` : '',
    base ? `${base}/v1/bridge/methods/${coinId}` : ''
  ].filter(Boolean)

  for (const url of candidates) {
    const json = await fetchJson(url, headers)
    const parsed = parsePolicyPayload(json)
    if (parsed) {
      const value: CoinDonationPolicy = { ...parsed, source: 'bridge' }
      policyCache.set(cacheKey, { ts: now, value })
      return value
    }
  }

  const envValue = readDonationPolicyFromEnv(network)
  if (envValue) {
    policyCache.set(cacheKey, { ts: now, value: envValue })
    return envValue
  }

  policyCache.set(cacheKey, { ts: now, value: null })
  return null
}

