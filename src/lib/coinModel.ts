import type { Network } from '../coins/types'
import { resolveNetworkCapabilities } from './networkCapabilities'

export type CoinModelFamily =
  | 'utxo-assets'
  | 'utxo-classic'
  | 'evm'
  | 'cosmos'
  | 'cardano'
  | 'generic'

export type CoinModelRouteKey =
  | 'utxo-assets'
  | 'utxo-classic'
  | 'evm'
  | 'cosmos'
  | 'cardano'
  | 'generic'

const COIN_MODEL_FAMILY_SORT_ORDER: Record<CoinModelFamily, number> = {
  evm: 0,
  cosmos: 1,
  'utxo-assets': 2,
  'utxo-classic': 3,
  cardano: 4,
  generic: 5
}

export function resolveCoinModelFamily(network: Network): CoinModelFamily {
  const modelId = String(network.runtimeModelId || network.id || '').trim().toLowerCase()
  if (modelId === 'ada') return 'cardano'
  if (modelId === 'cosmos') return 'cosmos'
  if (network.coinType === 'EVM') return 'evm'

  if (network.coinType === 'UTXO') {
    const caps = resolveNetworkCapabilities(network)
    return caps.features.assetLayer ? 'utxo-assets' : 'utxo-classic'
  }

  return 'generic'
}

export function coinModelFamilyToRouteKey(model: CoinModelFamily): CoinModelRouteKey {
  return model
}

export function coinModelRouteKeyToFamily(route: string): CoinModelFamily {
  if (
    route === 'utxo-assets'
    || route === 'utxo-classic'
    || route === 'evm'
    || route === 'cosmos'
    || route === 'cardano'
    || route === 'generic'
  ) return route
  return 'generic'
}

export function getCoinModelFamilySortRank(network: Network): number {
  const family = resolveCoinModelFamily(network)
  return COIN_MODEL_FAMILY_SORT_ORDER[family] ?? COIN_MODEL_FAMILY_SORT_ORDER.generic
}

export function compareNetworksByModelFamily(a: Network, b: Network): number {
  return getCoinModelFamilySortRank(a) - getCoinModelFamilySortRank(b)
}
