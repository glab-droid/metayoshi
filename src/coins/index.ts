import { getBundledCoinRegistryEntries } from './coinRegistry'
import { resolveEnabledNetworkIds } from './coinSelection'
import { SERVER_SCAFFOLD_COIN_MODULES } from './serverScaffoldCoins'
import { loadServerRegistrySnapshotFromApi } from './serverRegistry/runtime'
import { validateEthereumLayer2NetworkIdMapping } from './serverRegistry/mappings'
import { normalizeBridgeCredentialValue } from '../lib/bridgeCredentials'
import type { ServerCoinCatalogItem, ServerCoinCatalogKind } from './serverRegistry/types'
import type { CoinModule, CoinRuntimeContext, Network, UtxoAddressSpec } from './types'

export type { CoinType, Network } from './types'
export type { ServerCoinCatalogItem, ServerCoinCatalogKind } from './serverRegistry/types'
export { getCoinRuntimeProfile, type CoinRuntimeProfile } from './runtimeProfile'

const API_BASE_URL = String(import.meta.env.VITE_API_BASE_URL || '').trim().replace(/\/+$/, '')
const APP_API_KEY = String((import.meta as any)?.env?.VITE_APP_API_KEY || '').trim()
const GLOBAL_BRIDGE_USER = normalizeBridgeCredentialValue((import.meta as any)?.env?.VITE_BRIDGE_USER)
const GLOBAL_BRIDGE_PASSWORD = normalizeBridgeCredentialValue((import.meta as any)?.env?.VITE_BRIDGE_PASSWORD)

if ((GLOBAL_BRIDGE_USER && !GLOBAL_BRIDGE_PASSWORD) || (!GLOBAL_BRIDGE_USER && GLOBAL_BRIDGE_PASSWORD)) {
  throw new Error(
    'Bridge credentials are partially configured. ' +
    'Set both VITE_BRIDGE_USER and VITE_BRIDGE_PASSWORD, or leave both unset.'
  )
}

if (!API_BASE_URL) {
  throw new Error('VITE_API_BASE_URL is required. Set it in your environment (for example .env.local).')
}

export function buildBridgeUrl(coin: string, chain: 'main' | 'test', wallet?: string): string {
  const base = `${API_BASE_URL}/v1/bridge/${coin}/${chain}`
  return wallet ? `${base}/wallet/${encodeURIComponent(wallet)}` : base
}

const runtimeContext: CoinRuntimeContext = {
  apiBaseUrl: API_BASE_URL,
  buildBridgeUrl
}

export const DEFAULT_NETWORK_ID = 'rtm'
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
  ...getBundledCoinRegistryEntries().map((entry) => entry.coin),
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

function validateEnabledNetworkIds(enabledIds: Set<string>, knownIds: Set<string>): void {
  if (enabledIds.size <= 0) {
    throw new Error('No enabled networks were resolved from the bundled coin registry.')
  }
  for (const id of enabledIds) {
    if (!knownIds.has(id)) {
      throw new Error(`Enabled network id has no matching coin module: ${id}`)
    }
  }
}

function validateConfiguredNetworks(networks: Network[]): void {
  const seenIds = new Set<string>()

  for (const network of networks) {
    const id = String(network?.id || '').trim()
    const name = String(network?.name || '').trim()
    const symbol = String(network?.symbol || '').trim()
    const rpcUrl = String(network?.rpcUrl || '').trim()
    const registeredCoinModule = MODULE_BY_NETWORK_ID.get(id)

    if (!id) throw new Error('Configured network is missing `id`')
    if (seenIds.has(id)) throw new Error(`Duplicate configured network id: ${id}`)
    seenIds.add(id)

    if (!registeredCoinModule) {
      throw new Error(`Configured network ${id} has no registered coin module`)
    }
    if (!name) throw new Error(`Configured network ${id} is missing \`name\``)
    if (!symbol) throw new Error(`Configured network ${id} is missing \`symbol\``)
    if (!rpcUrl) throw new Error(`Configured network ${id} is missing \`rpcUrl\``)
    if (!network.capabilities) throw new Error(`Configured network ${id} is missing \`capabilities\``)

    if (network.coinType === 'UTXO') {
      const coinSymbol = String(network.coinSymbol || '').trim().toUpperCase()
      const feePerByte = Number(network.feePerByte)
      if (!coinSymbol) throw new Error(`UTXO network ${id} is missing \`coinSymbol\``)
      if (!UTXO_ADDRESS_SPECS[coinSymbol]) {
        throw new Error(`UTXO network ${id} has no registered address spec for ${coinSymbol}`)
      }
      if (!Number.isFinite(feePerByte) || feePerByte <= 0) {
        throw new Error(`UTXO network ${id} is missing a valid \`feePerByte\``)
      }
    }

    if (network.coinType === 'EVM') {
      if (!Number.isInteger(network.chainId) || Number(network.chainId) <= 0) {
        throw new Error(`EVM network ${id} is missing a valid numeric \`chainId\``)
      }
      if (!String(network.serverCoinId || '').trim()) {
        throw new Error(`EVM network ${id} is missing \`serverCoinId\``)
      }
    }

    if (network.coinType === 'COSMOS') {
      if (!String(network.runtimeModelId || '').trim()) {
        throw new Error(`Cosmos network ${id} is missing \`runtimeModelId\``)
      }
    }
  }
}

validateEnabledNetworkIds(ENABLED_NETWORK_IDS, ALL_COIN_IDS)
validateConfiguredNetworks(ALL_NETWORKS)
export const INITIAL_NETWORKS: Network[] = ALL_NETWORKS.filter((network) => ENABLED_NETWORK_IDS.has(network.id))

export const DEFAULT_ACTIVE_NETWORK_ID =
  INITIAL_NETWORKS.find((n) => n.id === (import.meta.env.VITE_DEFAULT_NETWORK ?? DEFAULT_NETWORK_ID))?.id
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
