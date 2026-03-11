import { BTCZ_PAYLOADS } from './btcz'
import {
  createCardanoPayloadCatalog,
  createCosmosPayloadCatalog,
  createEvmPayloadCatalog,
  createGenericPayloadCatalog,
  createSolanaPayloadCatalog,
  createStellarPayloadCatalog,
  createSuiPayloadCatalog,
  createTronPayloadCatalog,
  createUtxoPayloadCatalog
} from './common'
import { DASH_PAYLOADS } from './dash'
import { FIRO_PAYLOADS } from './firo'
import { RTM_PAYLOADS } from './rtm'
import { STANDARD_RUNTIME_META } from '../standardRuntimeMeta'
import { SERVER_SCAFFOLD_PAYLOADS_BY_NETWORK_ID } from './serverScaffolds'
import type { CoinPayloadCatalog } from './types'

export const PAYLOAD_CATALOG_ORDER = ['rtm', 'dash', 'btcz', 'firo'] as const

const PAYLOAD_CATALOG_REGISTRY: ReadonlyArray<{
  networkId: (typeof PAYLOAD_CATALOG_ORDER)[number]
  catalog: CoinPayloadCatalog
}> = [
  { networkId: 'rtm', catalog: RTM_PAYLOADS },
  { networkId: 'dash', catalog: DASH_PAYLOADS },
  { networkId: 'btcz', catalog: BTCZ_PAYLOADS },
  { networkId: 'firo', catalog: FIRO_PAYLOADS },
]

export const PAYLOADS_BY_NETWORK_ID = Object.fromEntries(
  PAYLOAD_CATALOG_REGISTRY.map((entry) => [entry.networkId, entry.catalog])
) as Record<(typeof PAYLOAD_CATALOG_ORDER)[number], CoinPayloadCatalog>

const dynamicPayloadCatalogCache = new Map<string, CoinPayloadCatalog>()

function normalizePayloadNetworkId(networkId?: string): string {
  const normalized = String(networkId || '').trim().toLowerCase()
  if (!normalized) return ''
  if (normalized === 'sdash' || normalized === 'srv--dash') return 'dash'
  if (normalized === 'btc' || normalized === 'bitcoin' || normalized === 'srv--btc') return 'srv--bitcoin'
  // Preserve scaffold IDs like "srv--bitcoin" and collapse only extra aliases
  // like "srv--bitcoin--alt" to their base scaffold key.
  if (normalized.startsWith('srv--')) {
    const parts = normalized.split('--')
    if (parts.length >= 2 && parts[1]) return `srv--${parts[1]}`
    return normalized
  }
  const aliasSep = normalized.indexOf('--')
  if (aliasSep > 0) return normalized.slice(0, aliasSep)
  return normalized
}

function createStandardPayloadCatalog(networkId: string): CoinPayloadCatalog | undefined {
  const meta = STANDARD_RUNTIME_META[networkId]
  if (!meta) return undefined
  const input = {
    networkId,
    symbol: meta.symbol,
    coinId: meta.coinId,
    chain: meta.chain || 'main'
  } as const
  switch (meta.protocolFamily) {
    case 'evm':
      return createEvmPayloadCatalog({ ...input, chainId: meta.chainId })
    case 'solana':
      return createSolanaPayloadCatalog(input)
    case 'cosmos':
      return createCosmosPayloadCatalog(input)
    case 'tron':
      return createTronPayloadCatalog(input)
    case 'cardano':
      return createCardanoPayloadCatalog(input)
    case 'sui':
      return createSuiPayloadCatalog(input)
    case 'stellar':
      return createStellarPayloadCatalog(input)
    case 'utxo':
    case 'xrp':
    case 'monero':
      return createUtxoPayloadCatalog(input)
    default:
      return createGenericPayloadCatalog(input)
  }
}

export function getCoinPayloadCatalog(networkId?: string) {
  const key = normalizePayloadNetworkId(networkId)
  if (!key) return undefined
  const direct = PAYLOADS_BY_NETWORK_ID[key as keyof typeof PAYLOADS_BY_NETWORK_ID]
  if (direct) return direct
  const scaffolded = SERVER_SCAFFOLD_PAYLOADS_BY_NETWORK_ID[key]
  if (scaffolded) return scaffolded
  if (dynamicPayloadCatalogCache.has(key)) return dynamicPayloadCatalogCache.get(key)
  const dynamic = createStandardPayloadCatalog(key)
  if (dynamic) dynamicPayloadCatalogCache.set(key, dynamic)
  return dynamic
}

export {
  RTM_PAYLOADS,
  DASH_PAYLOADS,
  BTCZ_PAYLOADS,
  FIRO_PAYLOADS,
}

export type { CoinPayloadCatalog, JsonRpcEnvelope, RestEnvelope, UtxoTxInputRef } from './types'
