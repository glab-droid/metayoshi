import type { CoinModule } from './types'
import { BUILD_CONFIG, getTestedModelIds } from '../buildConfig'

export const DISABLED_NETWORK_IDS = new Set<string>([
])

export const EVM_COIN_IDS = new Set<string>(['eth', 'arb', 'op', 'base', 'bnb', 'polygon', 'avaxc', 'cronos', 'zksync'])
export const EVM_ETHEREUM_L2_COIN_IDS = new Set<string>(['arb', 'op', 'base', 'zksync'])

const EVM_CHAIN_ID_TO_COIN_ID: Record<number, string> = {
  1: 'eth',
  10: 'op',
  25: 'cronos',
  56: 'bnb',
  137: 'polygon',
  324: 'zksync',
  42161: 'arb',
  43114: 'avaxc',
  8453: 'base'
}

const CHAINLIST_EVM_ALIAS_TO_COIN_ID: Record<string, string> = {
  eth: 'eth',
  ethereum: 'eth',
  'ethereum-mainnet': 'eth',
  'mainnet-ethereum': 'eth',
  arb: 'arb',
  arbitrum: 'arb',
  'arbitrum-one': 'arb',
  'mainnet-arbitrum': 'arb',
  op: 'op',
  optimism: 'op',
  'optimism-mainnet': 'op',
  'mainnet-optimism': 'op',
  base: 'base',
  'base-mainnet': 'base',
  'mainnet-base': 'base',
  bnb: 'bnb',
  bsc: 'bnb',
  'bnb-smart-chain': 'bnb',
  'binance-smart-chain': 'bnb',
  'bnb-smart-chain-mainnet': 'bnb',
  'binance-smart-chain-mainnet': 'bnb',
  'bsc-mainnet': 'bnb',
  'mainnet-bsc': 'bnb',
  zksync: 'zksync',
  'zksync-era': 'zksync',
  'zksync-mainnet': 'zksync',
  'mainnet-zksync': 'zksync',
  polygon: 'polygon',
  'polygon-pos': 'polygon',
  'polygon-mainnet': 'polygon',
  'polygon-bor': 'polygon',
  'mainnet-polygon': 'polygon',
  avax: 'avaxc',
  avaxc: 'avaxc',
  avalanche: 'avaxc',
  'avalanche-c-chain': 'avaxc',
  'mainnet-avalanche': 'avaxc',
  cronos: 'cronos',
  'cronos-mainnet': 'cronos',
  'cronos-evm': 'cronos',
  'mainnet-cronos': 'cronos'
}

function normalizeCoinSelectionToken(rawToken: string): string {
  return String(rawToken || '')
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
}

function mapChainlistAliasToCoinId(rawToken: string): string | null {
  const normalized = normalizeCoinSelectionToken(rawToken)
  if (!normalized) return null
  const direct = CHAINLIST_EVM_ALIAS_TO_COIN_ID[normalized]
  if (direct) return direct
  if (/^eip155:\d+$/.test(normalized)) {
    const chainId = Number(normalized.slice('eip155:'.length))
    if (Number.isFinite(chainId) && chainId > 0) return EVM_CHAIN_ID_TO_COIN_ID[chainId] || null
  }
  if (/^\d+$/.test(normalized)) {
    const chainId = Number(normalized)
    if (Number.isFinite(chainId) && chainId > 0) return EVM_CHAIN_ID_TO_COIN_ID[chainId] || null
  }
  return null
}

function expandEnabledCoinSelectionToken(rawToken: string): string[] {
  const token = normalizeCoinSelectionToken(rawToken)
  if (!token) return []
  if (token === 'btc' || token === 'bitcoin') return ['srv--bitcoin']
  if (token === 'ada' || token === 'cardano') return ['ada']
  if (token === 'cronos') return ['cronos']
  if (token === 'dash' || token === 'sdash' || token === 'srv--dash') return ['dash']
  if (token === 'doge' || token === 'dogecoin') return ['doge']
  if (token === 'evm') return [...EVM_COIN_IDS]
  if (token === 'evm-l2' || token === 'eth-l2' || token === 'l2') return [...EVM_ETHEREUM_L2_COIN_IDS]
  if (token === 'evm-l1') return [...EVM_COIN_IDS].filter((id) => !EVM_ETHEREUM_L2_COIN_IDS.has(id))
  if (token === 'trx' || token === 'tron') return ['tron']
  if (token === 'xlm' || token === 'stellar') return ['xlm']
  const chainlistMapped = mapChainlistAliasToCoinId(token)
  if (chainlistMapped) return [chainlistMapped]
  return [token]
}

function normalizeEnabledCoinIdTokens(rawTokens: string[], allowedCoinIds: Set<string>): string[] {
  const out: string[] = []
  for (const rawToken of rawTokens) {
    const expanded = expandEnabledCoinSelectionToken(rawToken)
    for (const id of expanded) {
      if (!id) continue
      if (!allowedCoinIds.has(id)) continue
      if (DISABLED_NETWORK_IDS.has(id)) continue
      out.push(id)
    }
  }
  return out
}

function normalizeDisabledCoinIdTokens(rawTokens: string[]): string[] {
  const out: string[] = []
  for (const rawToken of rawTokens) {
    const expanded = expandEnabledCoinSelectionToken(rawToken)
    for (const id of expanded) {
      if (!id) continue
      out.push(id)
    }
  }
  return out
}

function parseEnabledCoinIdsFromBuildConfig(defaultEnabledCoinIds: string[], allowedCoinIds: Set<string>): Set<string> | null {
  const enabledRaw = BUILD_CONFIG.coins?.enabled
  const disabled = new Set((BUILD_CONFIG.coins?.disabled || []).map((id) => String(id || '').trim().toLowerCase()).filter(Boolean))

  if (!enabledRaw && disabled.size === 0) return null

  const base = (() => {
    if (!enabledRaw) return new Set(defaultEnabledCoinIds)
    if (enabledRaw === 'all' || enabledRaw === '*') return new Set(allowedCoinIds)
    if (enabledRaw === 'tested') {
      const tested = getTestedModelIds().filter((id) => allowedCoinIds.has(id))
      return tested.length > 0 ? new Set(tested) : new Set(defaultEnabledCoinIds)
    }
    if (Array.isArray(enabledRaw)) {
      const selected = normalizeEnabledCoinIdTokens(
        enabledRaw
          .map((v) => String(v || '').trim().toLowerCase())
          .filter(Boolean),
        allowedCoinIds
      )
      return selected.length > 0 ? new Set(selected) : new Set(defaultEnabledCoinIds)
    }
    return new Set(defaultEnabledCoinIds)
  })()

  for (const id of disabled) base.delete(id)
  return base.size > 0 ? base : new Set(defaultEnabledCoinIds)
}

function parseEnabledCoinIds(raw: string | undefined, defaultEnabledCoinIds: string[], allowedCoinIds: Set<string>): Set<string> {
  const input = String(raw || '').trim().toLowerCase()
  if (!input) return new Set(defaultEnabledCoinIds)
  if (input === 'all' || input === '*') return new Set(allowedCoinIds)

  const selected = input
    .split(',')
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean)

  const resolved = normalizeEnabledCoinIdTokens(selected, allowedCoinIds)
  return resolved.length > 0 ? new Set(resolved) : new Set(defaultEnabledCoinIds)
}

function parseDisabledCoinIds(raw: string | undefined): Set<string> {
  const input = String(raw || '').trim().toLowerCase()
  if (!input) return new Set()
  const selected = input
    .split(',')
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean)
  const resolved = normalizeDisabledCoinIdTokens(selected)
  return new Set(resolved)
}

export function resolveEnabledNetworkIds(allCoinModules: CoinModule[]): Set<string> {
  const allCoinIds = new Set(allCoinModules.map((coin) => coin.id))
  const allowedCoinIds = new Set([...allCoinIds].filter((id) => !DISABLED_NETWORK_IDS.has(id)))
  const defaultEnabledCoinIds = [...allowedCoinIds]
  const enabledFromBuildConfig = parseEnabledCoinIdsFromBuildConfig(defaultEnabledCoinIds, allowedCoinIds)
  const enabledFromConfigOrEnv = enabledFromBuildConfig
    ?? parseEnabledCoinIds(import.meta.env.VITE_ENABLED_COINS as string | undefined, defaultEnabledCoinIds, allowedCoinIds)
  const disabledFromEnv = enabledFromBuildConfig
    ? new Set<string>()
    : parseDisabledCoinIds(import.meta.env.VITE_DISABLED_COINS as string | undefined)

  return new Set(
    [...enabledFromConfigOrEnv]
      .filter((id) => !disabledFromEnv.has(id))
      .filter((id) => !DISABLED_NETWORK_IDS.has(id))
  )
}
