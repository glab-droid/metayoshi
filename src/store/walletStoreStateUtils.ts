import { DEFAULT_ACTIVE_NETWORK_ID } from '../coins'
import type { Network } from '../coins'
import { isCroCosmosNetwork } from '../lib/runtimeModel'
import { resolveCosmosAddressConfig } from '../lib/cosmosAddress'

type AccountAddressBucket = {
  EVM?: string
  UTXO?: string
  BTC?: string
  COSMOS?: string
  SOL?: string
  SUI?: string
  XRP?: string
}

export interface WalletStoreAccountLike {
  id: string
  addresses?: AccountAddressBucket
  networkAddresses?: Record<string, string>
}

export interface WalletStoreActivityLike {
  id?: string
  type?: 'sent' | 'received' | 'swap' | string
  asset?: string
  amount?: string
  to?: string
  from?: string
  accountId?: string
  status?: 'pending' | 'confirmed' | 'rejected' | string
  timestamp?: number
  networkId?: string
}

export interface WalletStoreActivityNormalizationContext {
  networks: Network[]
  accounts: WalletStoreAccountLike[]
  activeNetworkId: string
  activeAccountId: string | null
}

export interface NormalizedWalletActivity {
  id: string
  type: 'sent' | 'received' | 'swap'
  asset: string
  amount: string
  to?: string
  from?: string
  accountId?: string
  status: 'pending' | 'confirmed' | 'rejected'
  timestamp: number
  networkId: string
}

const FROZEN_STABLE_NETWORK_IDS = new Set<string>(['rtm', 'eth', 'dash', 'btcz', 'firo'])
const LEGACY_CLASSIC_DEFAULT_VISIBLE_NETWORK_IDS = [
  'rtm',
  'srv--bitcoin',
  'eth',
  'arb',
  'op',
  'base',
  'polygon',
  'avaxc',
  'cronos',
  'cosmos'
]
const DEFAULT_VISIBLE_NETWORK_IDS = [
  'rtm',
  'srv--bitcoin',
  'eth',
  'base',
  'bnb',
  'op',
  'sol',
  'dash',
  'btcz',
  'cosmos'
]

export const MAX_ACTIVE_REFRESH_NETWORKS = 10

export function shouldForceCanonicalUtxoAddress(coinSymbol?: string): boolean {
  const symbol = String(coinSymbol || '').trim().toUpperCase()
  return symbol === 'TIDE'
}

export function isCroCosmosModel(network?: Partial<Network>): boolean {
  return isCroCosmosNetwork(network)
}

export function resolveCosmosNetworkConfig(network?: Partial<Network>): {
  hrp: string
  coinType: number
  decimals: number
  nativeDenom: string
  feeDenom: string
  feeAmountRaw: string
  gasLimit: string
} {
  const cfg = resolveCosmosAddressConfig({
    runtimeModelId: String(network?.runtimeModelId || '').trim(),
    serverCoinId: String(network?.serverCoinId || '').trim(),
    id: String(network?.id || '').trim()
  })
  return {
    hrp: cfg.hrp,
    coinType: cfg.coinType,
    decimals: cfg.decimals,
    nativeDenom: cfg.nativeDenom,
    feeDenom: cfg.feeDenom,
    feeAmountRaw: cfg.feeAmountRaw,
    gasLimit: cfg.gasLimit
  }
}

export function parseDecimalToAtomicUnits(value: string, decimals: number, label: string): bigint {
  const raw = String(value || '').trim()
  if (!/^\d+(\.\d+)?$/.test(raw)) throw new Error(`Invalid ${label} amount`)
  const [whole, fraction = ''] = raw.split('.')
  if (fraction.length > decimals) throw new Error(`${label} supports up to ${decimals} decimals`)
  const atomic = `${whole}${fraction.padEnd(decimals, '0')}`
  const n = BigInt(atomic)
  if (n <= 0n) throw new Error(`${label} amount must be greater than 0`)
  return n
}

export function normalizeNetworkSymbol(network: Network): Network {
  const serverCoinId = String(network.serverCoinId || '').trim().toLowerCase()
  const networkId = String(network.id || '').trim().toLowerCase()
  const networkName = String(network.name || '').trim().toLowerCase()
  const symbol = String(network.symbol || '').trim().toUpperCase()
  const coinSymbol = String(network.coinSymbol || '').trim().toUpperCase()
  const isBitcoin =
    serverCoinId === 'bitcoin'
    || networkId === 'srv--bitcoin'
    || networkName === 'bitcoin'
    || symbol === 'BITCOI'
    || coinSymbol === 'BITCOI'
  if (!isBitcoin) return network
  return {
    ...network,
    symbol: 'BTC',
    coinSymbol: network.coinType === 'UTXO' ? 'BTC' : (network.coinSymbol || 'BTC')
  }
}

export function normalizeNetworkIdAlias(value: string): string {
  const raw = String(value || '').trim()
  const normalized = raw.toLowerCase()
  if (!normalized) return ''
  if (normalized === 'sdash' || normalized === 'srv--dash') return 'dash'
  if (normalized === 'btc' || normalized === 'bitcoin' || normalized === 'srv--btc') return 'srv--bitcoin'
  if (normalized === 'ada' || normalized === 'cardano') return 'ada'
  if (normalized === 'arb' || normalized === 'arbitrum' || normalized === 'arbitrum-one') return 'arb'
  if (normalized === 'doge' || normalized === 'dogecoin') return 'doge'
  if (normalized === 'op' || normalized === 'optimism' || normalized === 'eth-l2--optimism') return 'op'
  if (normalized === 'trx' || normalized === 'tron') return 'tron'
  if (normalized === 'xlm' || normalized === 'stellar') return 'xlm'
  if (normalized === 'avax' || normalized === 'avaxc' || normalized === 'avalanche' || normalized === 'avalanche-c-chain') return 'avaxc'
  if (normalized.endsWith('-mainnet')) {
    const base = normalized.slice(0, -'-mainnet'.length)
    if (FROZEN_STABLE_NETWORK_IDS.has(base)) return base
  }
  if (FROZEN_STABLE_NETWORK_IDS.has(normalized)) return normalized
  if (normalized.startsWith('srv--')) return normalized
  return raw
}

export function resolveKnownNetworkId(networks: Network[], rawNetworkId: string): string | null {
  const raw = String(rawNetworkId || '').trim()
  const requested = normalizeNetworkIdAlias(raw)
  if (!requested && !raw) return null

  const exact = networks.find((network) => (
    network.id === requested
    || network.id === raw
  ))
  if (exact) return exact.id

  const requestedLower = requested.toLowerCase()
  const rawLower = raw.toLowerCase()
  const folded = networks.find((network) => (
    network.id.toLowerCase() === requestedLower
    || network.id.toLowerCase() === rawLower
  ))
  return folded?.id || null
}

export function normalizeDisabledNetworkIdsForState(disabledNetworkIds: unknown, networks: Network[]): string[] {
  if (!Array.isArray(disabledNetworkIds) || networks.length === 0) return []
  const canonicalByLower = new Map<string, string>()
  for (const network of networks) {
    const id = String(network.id || '').trim()
    if (!id) continue
    canonicalByLower.set(id.toLowerCase(), id)
    const alias = normalizeNetworkIdAlias(id)
    if (alias) canonicalByLower.set(alias.toLowerCase(), id)
  }

  const out: string[] = []
  const seen = new Set<string>()
  for (const value of disabledNetworkIds) {
    const raw = String(value || '').trim()
    if (!raw) continue
    const candidates = [raw, normalizeNetworkIdAlias(raw)]
    let resolved = ''
    for (const candidate of candidates) {
      const key = String(candidate || '').trim().toLowerCase()
      if (!key) continue
      const mapped = canonicalByLower.get(key)
      if (mapped) {
        resolved = mapped
        break
      }
    }
    if (!resolved || seen.has(resolved)) continue
    seen.add(resolved)
    out.push(resolved)
  }
  if (networks.length > 0 && out.length >= networks.length) {
    const firstNetworkId = String(networks[0]?.id || '').trim()
    return out.filter((networkId) => networkId !== firstNetworkId)
  }
  return out
}

export function resolveDefaultDisabledNetworkIds(networks: Network[]): string[] {
  return resolvePreferredDefaultDisabledNetworkIds(networks, DEFAULT_VISIBLE_NETWORK_IDS)
}

export function migrateLegacyDefaultDisabledNetworkIds(disabledNetworkIds: unknown, networks: Network[]): string[] {
  const normalizedDisabled = normalizeDisabledNetworkIdsForState(disabledNetworkIds, networks)
  if (networks.length <= MAX_ACTIVE_REFRESH_NETWORKS) return normalizedDisabled

  const legacyDefaultDisabled = resolvePreferredDefaultDisabledNetworkIds(networks, LEGACY_CLASSIC_DEFAULT_VISIBLE_NETWORK_IDS)
  if (!areSameNetworkIdSet(normalizedDisabled, legacyDefaultDisabled)) return normalizedDisabled

  return resolvePreferredDefaultDisabledNetworkIds(networks, DEFAULT_VISIBLE_NETWORK_IDS)
}

function resolvePreferredDefaultDisabledNetworkIds(networks: Network[], preferredVisibleNetworkIds: string[]): string[] {
  if (networks.length <= MAX_ACTIVE_REFRESH_NETWORKS) return []

  const visibleIds: string[] = []
  const visibleSet = new Set<string>()
  for (const preferredId of preferredVisibleNetworkIds) {
    const resolved = resolveKnownNetworkId(networks, preferredId)
    if (!resolved || visibleSet.has(resolved)) continue
    visibleSet.add(resolved)
    visibleIds.push(resolved)
    if (visibleIds.length >= MAX_ACTIVE_REFRESH_NETWORKS) break
  }

  if (visibleIds.length < MAX_ACTIVE_REFRESH_NETWORKS) {
    for (const network of networks) {
      const networkId = String(network.id || '').trim()
      if (!networkId || visibleSet.has(networkId)) continue
      visibleSet.add(networkId)
      visibleIds.push(networkId)
      if (visibleIds.length >= MAX_ACTIVE_REFRESH_NETWORKS) break
    }
  }

  return normalizeDisabledNetworkIdsForState(
    networks
      .map((network) => String(network.id || '').trim())
      .filter((networkId) => networkId && !visibleSet.has(networkId)),
    networks
  )
}

function areSameNetworkIdSet(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false
  const rightSet = new Set(right)
  return left.every((networkId) => rightSet.has(networkId))
}

export function clampDisabledNetworkIdsToMaxEnabled(disabledNetworkIds: unknown, networks: Network[]): string[] {
  const normalizedDisabled = normalizeDisabledNetworkIdsForState(disabledNetworkIds, networks)
  if (networks.length <= MAX_ACTIVE_REFRESH_NETWORKS) return normalizedDisabled

  const disabledSet = new Set(normalizedDisabled)
  const enabledNetworks = networks.filter((network) => !disabledSet.has(String(network.id || '').trim()))
  if (enabledNetworks.length <= MAX_ACTIVE_REFRESH_NETWORKS) return normalizedDisabled

  const keepEnabled = new Set(
    enabledNetworks
      .slice(0, MAX_ACTIVE_REFRESH_NETWORKS)
      .map((network) => String(network.id || '').trim())
      .filter(Boolean)
  )

  return normalizeDisabledNetworkIdsForState(
    networks
      .map((network) => String(network.id || '').trim())
      .filter((networkId) => networkId && !keepEnabled.has(networkId)),
    networks
  )
}

export function resolveEnabledNetworkId(
  networks: Network[],
  disabledNetworkIds: string[],
  preferredNetworkId?: string | null
): string {
  const normalizedDisabled = new Set(normalizeDisabledNetworkIdsForState(disabledNetworkIds, networks))
  const preferred = resolveKnownNetworkId(networks, String(preferredNetworkId || '').trim())
  if (preferred && !normalizedDisabled.has(preferred)) return preferred
  const firstEnabled = networks.find((network) => !normalizedDisabled.has(network.id))
  return firstEnabled?.id || networks[0]?.id || DEFAULT_ACTIVE_NETWORK_ID
}

export function resolveEthereumOnlyNetworkDefaults(networks: Network[]): { activeNetworkId: string; disabledNetworkIds: string[] } {
  const ethereumNetworkId = resolveKnownNetworkId(networks, 'eth')
  if (!ethereumNetworkId) {
    return {
      activeNetworkId: resolveEnabledNetworkId(networks, [], DEFAULT_ACTIVE_NETWORK_ID),
      disabledNetworkIds: []
    }
  }

  const disabledNetworkIds = normalizeDisabledNetworkIdsForState(
    networks
      .map((network) => String(network.id || '').trim())
      .filter((id) => id && id !== ethereumNetworkId),
    networks
  )

  return {
    activeNetworkId: resolveEnabledNetworkId(networks, disabledNetworkIds, ethereumNetworkId),
    disabledNetworkIds
  }
}

export function remapNetworkIdKeyedRecord<T>(record: Record<string, T> | undefined): Record<string, T> {
  const out: Record<string, T> = {}
  if (!record || typeof record !== 'object') return out
  for (const [rawKey, value] of Object.entries(record)) {
    const canonicalKey = normalizeNetworkIdAlias(rawKey) || String(rawKey || '').trim()
    if (!canonicalKey) continue
    const isCanonicalInput = canonicalKey === String(rawKey || '').trim()
    if (!(canonicalKey in out) || isCanonicalInput) {
      out[canonicalKey] = value
    }
  }
  return out
}

function resolveCanonicalActivityNetworkId(
  rawNetworkId: unknown,
  context: WalletStoreActivityNormalizationContext
): string {
  const requested = normalizeNetworkIdAlias(String(rawNetworkId || '').trim())
  if (requested) {
    const exact = context.networks.find((network) => network.id === requested)
    if (exact) return exact.id
    const fold = context.networks.find((network) => network.id.toLowerCase() === requested.toLowerCase())
    if (fold) return fold.id
  }

  const activeRequested = normalizeNetworkIdAlias(String(context.activeNetworkId || '').trim())
  if (activeRequested) {
    const exact = context.networks.find((network) => network.id === activeRequested)
    if (exact) return exact.id
    const fold = context.networks.find((network) => network.id.toLowerCase() === activeRequested.toLowerCase())
    if (fold) return fold.id
  }

  return context.networks[0]?.id || activeRequested || requested
}

function resolveActivityAccountId(
  rawAccountId: unknown,
  rawFrom: unknown,
  rawTo: unknown,
  networkId: string,
  context: WalletStoreActivityNormalizationContext
): string | undefined {
  const isKnownAccountId = (candidate: string): boolean => (
    Boolean(candidate) && context.accounts.some((account) => account.id === candidate)
  )

  const explicitId = String(rawAccountId || '').trim()
  if (isKnownAccountId(explicitId)) return explicitId

  const normalizedFrom = String(rawFrom || '').trim().toLowerCase()
  const normalizedTo = String(rawTo || '').trim().toLowerCase()
  const hasAddressHint = Boolean(normalizedFrom || normalizedTo)

  const network = context.networks.find((entry) => entry.id === networkId)
  if (hasAddressHint) {
    const inferred = context.accounts.find((account) => {
      const candidates = new Set<string>()
      const push = (value: unknown) => {
        const normalized = String(value || '').trim().toLowerCase()
        if (normalized) candidates.add(normalized)
      }

      push(account.networkAddresses?.[networkId])
      if (network?.coinType === 'EVM') push(account.addresses?.EVM)
      else if (network?.coinType === 'XRP') push(account.addresses?.XRP)
      else if (network?.coinType === 'UTXO') {
        push(account.addresses?.UTXO)
        push(account.addresses?.BTC)
      } else if (network?.coinType === 'COSMOS') {
        push(account.addresses?.COSMOS)
      } else if (network?.coinType === 'SUI') {
        push(account.addresses?.SUI)
      } else if (!network) {
        Object.values(account.networkAddresses || {}).forEach(push)
        push(account.addresses?.EVM)
        push(account.addresses?.UTXO)
        push(account.addresses?.BTC)
        push(account.addresses?.COSMOS)
        push(account.addresses?.SOL)
        push(account.addresses?.SUI)
        push(account.addresses?.XRP)
      }

      return (
        (normalizedFrom && candidates.has(normalizedFrom))
        || (normalizedTo && candidates.has(normalizedTo))
      )
    })
    if (inferred?.id) return inferred.id
  }

  const activeId = String(context.activeAccountId || '').trim()
  if (isKnownAccountId(activeId)) return activeId

  const firstId = String(context.accounts[0]?.id || '').trim()
  if (isKnownAccountId(firstId)) return firstId

  return undefined
}

export function normalizeActivityRecord(
  rawActivity: unknown,
  context: WalletStoreActivityNormalizationContext,
  indexHint: number
): NormalizedWalletActivity | null {
  if (!rawActivity || typeof rawActivity !== 'object') return null
  const candidate = rawActivity as WalletStoreActivityLike
  const networkId = resolveCanonicalActivityNetworkId(candidate.networkId, context)
  if (!networkId) return null

  const timestampRaw = Number(candidate.timestamp)
  const timestamp = Number.isFinite(timestampRaw) && timestampRaw > 0
    ? Math.trunc(timestampRaw)
    : Date.now()

  const typeRaw = String(candidate.type || '').trim().toLowerCase()
  const type: NormalizedWalletActivity['type'] =
    typeRaw === 'received' ? 'received'
      : typeRaw === 'swap' ? 'swap'
        : 'sent'

  const statusRaw = String(candidate.status || '').trim().toLowerCase()
  const status: NormalizedWalletActivity['status'] =
    statusRaw === 'pending' ? 'pending'
      : statusRaw === 'rejected' ? 'rejected'
        : 'confirmed'

  const id = String(candidate.id || '').trim() || `activity-${timestamp}-${indexHint}`
  const network = context.networks.find((entry) => entry.id === networkId)
  const asset = String(candidate.asset || '').trim() || String(network?.symbol || '').trim() || 'UNKNOWN'
  const amount = String(candidate.amount || '').trim() || '0'
  const from = String(candidate.from || '').trim()
  const to = String(candidate.to || '').trim()
  const accountId = resolveActivityAccountId(candidate.accountId, from, to, networkId, context)

  return {
    id,
    type,
    asset,
    amount,
    to: to || undefined,
    from: from || undefined,
    accountId,
    status,
    timestamp,
    networkId
  }
}

export function normalizeActivityList(
  rawActivity: unknown,
  context: WalletStoreActivityNormalizationContext
): NormalizedWalletActivity[] {
  if (!Array.isArray(rawActivity)) return []
  const out: NormalizedWalletActivity[] = []
  rawActivity.forEach((entry, index) => {
    const normalized = normalizeActivityRecord(entry, context, index)
    if (normalized) out.push(normalized)
  })
  return out
}
