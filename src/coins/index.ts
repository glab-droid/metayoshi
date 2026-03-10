import { adaCoin } from './ada'
import { arbCoin } from './arb'
import { avaxcCoin } from './avaxc'
import { baseCoin } from './base'
import { bnbCoin } from './bnb'
import { btcCoin } from './btc'
import { btczCoin } from './btcz'
import { cosmosCoin } from './cosmos'
import { cronosCoin } from './cronos'
import { dashCoin } from './dash'
import { dogeCoin } from './doge'
import { ethCoin } from './eth'
import { firoCoin } from './firo'
import { opCoin } from './op'
import { polygonCoin } from './polygon'
import { rtmCoin } from './rtm'
import { solCoin } from './sol'
import { suiCoin } from './sui'
import { tronCoin } from './tron'
import { xlmCoin } from './xlm'
import { zksyncCoin } from './zksync'
import { resolveEnabledNetworkIds } from './coinSelection'
import { SERVER_SCAFFOLD_COIN_MODULES } from './serverScaffoldCoins'
import { loadServerRegistrySnapshotFromApi } from './serverRegistry/runtime'
import { validateEthereumLayer2NetworkIdMapping } from './serverRegistry/mappings'
import { getModelStatus } from '../buildConfig'
import { normalizeBridgeCredentialValue } from '../lib/bridgeCredentials'
import { resolveRuntimeModelId } from '../lib/runtimeModel'
import type { ServerCoinCatalogItem, ServerCoinCatalogKind } from './serverRegistry/types'
import type { CoinModule, CoinRuntimeContext, Network, UtxoAddressSpec } from './types'

export type { CoinType, Network } from './types'
export type { ServerCoinCatalogItem, ServerCoinCatalogKind } from './serverRegistry/types'
export { getCoinRuntimeProfile, type CoinRuntimeProfile } from './runtimeProfile'

const DEFAULT_API_BASE_URL = 'https://api.metayoshi.app'
// Release builds need a stable backend default so the extension can boot
// without a local `.env` file.
const API_BASE_URL = String(import.meta.env.VITE_API_BASE_URL || DEFAULT_API_BASE_URL).trim().replace(/\/+$/, '')
const APP_API_KEY = String((import.meta as any)?.env?.VITE_APP_API_KEY || '').trim()
const GLOBAL_BRIDGE_USER = normalizeBridgeCredentialValue((import.meta as any)?.env?.VITE_BRIDGE_USER)
const GLOBAL_BRIDGE_PASSWORD = normalizeBridgeCredentialValue((import.meta as any)?.env?.VITE_BRIDGE_PASSWORD)

if ((GLOBAL_BRIDGE_USER && !GLOBAL_BRIDGE_PASSWORD) || (!GLOBAL_BRIDGE_USER && GLOBAL_BRIDGE_PASSWORD)) {
  throw new Error(
    'Bridge credentials are partially configured. ' +
    'Set both VITE_BRIDGE_USER and VITE_BRIDGE_PASSWORD, or leave both unset.'
  )
}

export function buildBridgeUrl(coin: string, chain: 'main' | 'test', wallet?: string): string {
  const base = `${API_BASE_URL}/v1/bridge/${coin}/${chain}`
  return wallet ? `${base}/wallet/${encodeURIComponent(wallet)}` : base
}

const runtimeContext: CoinRuntimeContext = {
  apiBaseUrl: API_BASE_URL,
  buildBridgeUrl
}

// Public startup should prefer a network that can boot without the private
// bridge path used by legacy RTM-first builds.
export const DEFAULT_NETWORK_ID = 'sol'
export const DEFAULT_UTXO_COIN_SYMBOL = 'RTM'

function uniqCoinModulesById(modules: CoinModule[]): CoinModule[] {
  const out: CoinModule[] = []
  const seen = new Set<string>()
  for (const mod of modules) {
    const id = String(mod?.id || '').trim()
    if (!id) continue
    if (seen.has(id)) continue
    seen.add(id)
    out.push(mod)
  }
  return out
}

const RAW_COIN_MODULES: CoinModule[] = [
  rtmCoin,
  btcCoin,
  ethCoin,
  bnbCoin,
  arbCoin,
  opCoin,
  baseCoin,
  polygonCoin,
  avaxcCoin,
  cronosCoin,
  cosmosCoin,
  tronCoin,
  solCoin,
  adaCoin,
  suiCoin,
  xlmCoin,
  dogeCoin,
  firoCoin,
  dashCoin,
  btczCoin,
  zksyncCoin,
  ...SERVER_SCAFFOLD_COIN_MODULES
]

export const ALL_COIN_MODULES: CoinModule[] = uniqCoinModulesById(RAW_COIN_MODULES)

const ALL_COIN_IDS = new Set(ALL_COIN_MODULES.map((coin) => coin.id))
export const ENABLED_NETWORK_IDS = resolveEnabledNetworkIds(ALL_COIN_MODULES)

const MODULE_BY_NETWORK_ID = new Map<string, CoinModule>(
  ALL_COIN_MODULES.map((coin) => [coin.id, coin])
)

const UTXO_ADDRESS_SPECS: Record<string, UtxoAddressSpec> = {}
for (const coin of ALL_COIN_MODULES) {
  if (!coin.coinSymbol || !coin.utxoAddress) continue
  const symbol = coin.coinSymbol.toUpperCase()
  if (!UTXO_ADDRESS_SPECS[symbol]) {
    UTXO_ADDRESS_SPECS[symbol] = coin.utxoAddress
  }
}

function withGlobalBridgeCredentials(network: Network): Network {
  if (!GLOBAL_BRIDGE_USER || !GLOBAL_BRIDGE_PASSWORD) return network
  return {
    ...network,
    bridgeUsername: GLOBAL_BRIDGE_USER,
    bridgePassword: GLOBAL_BRIDGE_PASSWORD
  }
}

export const ALL_NETWORKS: Network[] = ALL_COIN_MODULES
  .map((coin) => coin.createNetwork(runtimeContext))
  .map(withGlobalBridgeCredentials)
export const INITIAL_NETWORKS: Network[] = ALL_NETWORKS.filter((network) => ENABLED_NETWORK_IDS.has(network.id))

function getPublicStartupPriority(network: Network): number {
  if (network.derivation?.status === 'unsupported') return Number.NEGATIVE_INFINITY

  const modelId = resolveRuntimeModelId(network)
  const statusBonus = getModelStatus(modelId) === 'tested' ? 10 : 0

  if (modelId === 'sol') return 300 + statusBonus
  // EVM chains remain the preferred general fallback when SOL is disabled.
  if (network.coinType === 'EVM') return 240 + statusBonus
  if (modelId === 'tron') return 200 + statusBonus
  if (modelId === 'sui') return 190 + statusBonus

  return Number.NEGATIVE_INFINITY
}

export function resolvePublicStartupNetworkId(networks: Network[]): string | null {
  let bestNetwork: Network | null = null
  let bestPriority = Number.NEGATIVE_INFINITY

  for (const network of networks) {
    const priority = getPublicStartupPriority(network)
    if (priority > bestPriority) {
      bestPriority = priority
      bestNetwork = network
    }
  }

  return bestNetwork?.id || null
}

const requestedDefaultNetworkId = String(import.meta.env.VITE_DEFAULT_NETWORK || '').trim()
const publicStartupNetworkId = resolvePublicStartupNetworkId(INITIAL_NETWORKS)

export const DEFAULT_ACTIVE_NETWORK_ID =
  INITIAL_NETWORKS.find((n) => n.id === requestedDefaultNetworkId)?.id
  ?? publicStartupNetworkId
  ?? INITIAL_NETWORKS[0]?.id
  ?? DEFAULT_NETWORK_ID

export function getUtxoAddressSpec(coinSymbol: string): UtxoAddressSpec | undefined {
  return UTXO_ADDRESS_SPECS[coinSymbol.toUpperCase()]
}

export function getAllUtxoAddressSpecs(): Record<string, UtxoAddressSpec> {
  return { ...UTXO_ADDRESS_SPECS }
}

export function estimateNetworkFee(networkId: string, txBytes: number): number | undefined {
  const module = MODULE_BY_NETWORK_ID.get(networkId)
  if (module?.estimateFee) return module.estimateFee(txBytes)
  const network = ALL_NETWORKS.find((n) => n.id === networkId)
  const feePerByte = Number(network?.feePerByte)
  if (Number.isFinite(feePerByte) && feePerByte > 0) return txBytes * feePerByte
  return undefined
}

validateEthereumLayer2NetworkIdMapping()

export async function loadServerRegistrySnapshot(): Promise<{
  networks: Network[] | null
  catalog: ServerCoinCatalogItem[]
}> {
  return loadServerRegistrySnapshotFromApi({
    apiBaseUrl: API_BASE_URL,
    appApiKey: APP_API_KEY,
    defaultBridgeUser: GLOBAL_BRIDGE_USER,
    defaultBridgePassword: GLOBAL_BRIDGE_PASSWORD,
    allNetworks: ALL_NETWORKS,
    allCoinIds: ALL_COIN_IDS
  })
}

export async function loadNetworksFromServerRegistry(): Promise<Network[] | null> {
  const snapshot = await loadServerRegistrySnapshot()
  return snapshot.networks
}
