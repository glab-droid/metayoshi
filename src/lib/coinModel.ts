import type { Network } from '../coins/types'
import { resolveNetworkCapabilities } from './networkCapabilities'

export type CoinModelFamily =
  | 'utxo-assets'
  | 'utxo-classic'
  | 'xrp-ledger'
  | 'evm'
  | 'cosmos'
  | 'cardano'
  | 'monero'
  | 'generic'

export type CoinModelRouteKey =
  | 'utxo-assets'
  | 'utxo-classic'
  | 'xrp'
  | 'evm'
  | 'cosmos'
  | 'cardano'
  | 'monero'
  | 'generic'

const COIN_MODEL_FAMILY_SORT_ORDER: Record<CoinModelFamily, number> = {
  evm: 0,
  cosmos: 1,
  'utxo-assets': 2,
  'utxo-classic': 3,
  'xrp-ledger': 4,
  cardano: 5,
  monero: 6,
  generic: 7
}

export function resolveCoinModelFamily(network: Network): CoinModelFamily {
  const modelId = String(network.runtimeModelId || network.id || '').trim().toLowerCase()
  if (modelId === 'ada') return 'cardano'
  if (modelId === 'cosmos' || modelId === 'cro' || modelId === 'crocosmos') return 'cosmos'
  if (modelId === 'xmr') return 'monero'
  if (network.coinType === 'EVM') return 'evm'
  if (network.coinType === 'XRP') return 'xrp-ledger'

  if (network.coinType === 'UTXO') {
    const caps = resolveNetworkCapabilities(network)
    return caps.features.assetLayer ? 'utxo-assets' : 'utxo-classic'
  }

  return 'generic'
}

export function coinModelFamilyToRouteKey(model: CoinModelFamily): CoinModelRouteKey {
  if (model === 'xrp-ledger') return 'xrp'
  return model
}

export function coinModelRouteKeyToFamily(route: string): CoinModelFamily {
  if (route === 'xrp') return 'xrp-ledger'
  if (
    route === 'utxo-assets'
    || route === 'utxo-classic'
    || route === 'evm'
    || route === 'cosmos'
    || route === 'cardano'
    || route === 'monero'
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
