import type { Network } from '../types'
import { buildServerCoinCatalog, isLikelyTokenServerCoin } from './catalog'
import {
  EVM_MODEL_NETWORK_IDS,
  isBlockedServerCoinId,
  mapServerCoinIdToNetworkId,
  normalizeServerCoinSymbol,
  resolveAppNetworkId
} from './mappings'
import {
  createGenericServerNetwork,
  inferBridgeCapabilities,
  isNetworkSpendable,
  isPublicnodeNetworkRow,
  mergeCapabilityInputs,
  resolveActiveServerNetwork,
  resolveBridgeUrlForNetwork,
  scoreCandidate,
  supportsEvmBridgeMethods
} from './networks'
import {
  isServerCoinBridgeEnabled,
  resolveServerCoinChain,
  resolveServerCoinId,
  type NetworkCandidate,
  type ServerCoinCatalogItem,
  type ServerCoinRow
} from './types'

export async function loadServerRegistrySnapshotFromApi(input: {
  apiBaseUrl: string
  appApiKey: string
  defaultBridgeUser?: string
  defaultBridgePassword?: string
  allNetworks: Network[]
  allCoinIds: Set<string>
}): Promise<{
  networks: Network[] | null
  catalog: ServerCoinCatalogItem[]
}> {
  const headers: Record<string, string> = {}
  if (input.appApiKey) headers['X-API-Key'] = input.appApiKey
  const response = await fetch(`${input.apiBaseUrl}/v1/coins`, { method: 'GET', headers })
  if (!response.ok) {
    throw new Error(`Server coin registry fetch failed: HTTP ${response.status}`)
  }
  const json = await response.json().catch(() => null)
  const coins = Array.isArray(json?.coins) ? (json.coins as ServerCoinRow[]) : []
  if (coins.length === 0) return { networks: null, catalog: [] }

  const catalog = buildServerCoinCatalog(coins)
  const spendableMainCoinIds = new Set<string>()
  const moduleById = new Map<string, Network>(input.allNetworks.map((n) => [n.id, n]))
  const candidatesByAppNetworkId = new Map<string, NetworkCandidate[]>()

  for (const coin of coins) {
    if (!coin?.enabled) continue
    if (!isServerCoinBridgeEnabled(coin)) continue
    const coinId = resolveServerCoinId(coin)
    if (!coinId) continue
    if (isBlockedServerCoinId(coinId)) continue
    if (isLikelyTokenServerCoin(coin)) continue

    const modelNetworkId = mapServerCoinIdToNetworkId(coinId)
    const selectedNetwork = resolveActiveServerNetwork(coin.networks)
    const chain = resolveServerCoinChain(coin, selectedNetwork)
    const rpcWallet = String(selectedNetwork?.rpcWallet || '').trim()
    const modernBridgeReady = Boolean(
      coin.bridgeImplemented !== false
      && coin.capabilities?.rpcBridge !== false
      && (
        coin.capabilities?.sync
        || coin.capabilities?.balance
        || coin.capabilities?.history
        || coin.capabilities?.send
        || coin.capabilities?.broadcast
      )
    )

    const canUseMappedModel = Boolean(
      modelNetworkId
      && moduleById.get(modelNetworkId)
      && (
        !EVM_MODEL_NETWORK_IDS.has(modelNetworkId)
        || supportsEvmBridgeMethods(coin.methodGroups)
        || modernBridgeReady
      )
    )

    if (canUseMappedModel && modelNetworkId) {
      const base = moduleById.get(modelNetworkId)!
      const appNetworkId = resolveAppNetworkId(modelNetworkId, coinId)
      const inferredCapabilities = inferBridgeCapabilities(
        coinId,
        modelNetworkId,
        coin.methodGroups,
        coin.capabilities
      )
      const mergedCapabilities = mergeCapabilityInputs(base.capabilities, inferredCapabilities)
      const mappedNetwork: Network = {
        ...base,
        id: appNetworkId,
        runtimeModelId: String(base.runtimeModelId || modelNetworkId || '').trim() || undefined,
        serverCoinId: coinId,
        serverChain: chain,
        name: String(coin.name || base.name).trim() || base.name,
        symbol: normalizeServerCoinSymbol(coinId, String(coin.symbol || '').trim(), base.symbol) || base.symbol,
        rpcUrl: String(selectedNetwork?.rpcUrl || base.rpcUrl).trim() || base.rpcUrl,
        rpcWallet: rpcWallet || base.rpcWallet || '',
        rpcUsername: String(selectedNetwork?.rpcUser || base.rpcUsername || '').trim(),
        bridgeUrl: resolveBridgeUrlForNetwork(input.apiBaseUrl, modelNetworkId, coinId, chain, rpcWallet),
        bridgeUsername: input.defaultBridgeUser || undefined,
        bridgePassword: input.defaultBridgePassword || undefined,
        capabilities: mergedCapabilities
      }
      if (!isNetworkSpendable(mappedNetwork)) continue
      const row = candidatesByAppNetworkId.get(appNetworkId) || []
      row.push({
        appNetworkId,
        network: mappedNetwork,
        chain,
        isPublicnode: selectedNetwork ? isPublicnodeNetworkRow(selectedNetwork) : false
      })
      candidatesByAppNetworkId.set(appNetworkId, row)
      spendableMainCoinIds.add(coinId)
      continue
    }

    const genericNetwork = createGenericServerNetwork({
      apiBaseUrl: input.apiBaseUrl,
      defaultBridgeUser: input.defaultBridgeUser,
      defaultBridgePassword: input.defaultBridgePassword,
      coinId,
      coin,
      chain,
      selectedNetwork
    })
    if (!isNetworkSpendable(genericNetwork)) continue
    const row = candidatesByAppNetworkId.get(genericNetwork.id) || []
    row.push({
      appNetworkId: genericNetwork.id,
      network: genericNetwork,
      chain,
      isPublicnode: selectedNetwork ? isPublicnodeNetworkRow(selectedNetwork) : false
    })
    candidatesByAppNetworkId.set(genericNetwork.id, row)
  }

  if (candidatesByAppNetworkId.size === 0) {
    const filteredCatalog = catalog.filter((item) => item.kind !== 'main' || spendableMainCoinIds.has(item.coinId))
    return {
      networks: null,
      catalog: filteredCatalog
    }
  }

  const bestByNetworkId = new Map<string, Network>()
  for (const [appNetworkId, rows] of candidatesByAppNetworkId.entries()) {
    if (!rows || rows.length === 0) continue
    const sorted = [...rows].sort((a, b) => scoreCandidate(b) - scoreCandidate(a))
    bestByNetworkId.set(appNetworkId, sorted[0].network)
  }

  const selectedIds = new Set(bestByNetworkId.keys())
  const canonical = input.allNetworks.filter((n) => selectedIds.has(n.id)).map((n) => (
    bestByNetworkId.get(n.id) || n
  ))
  const extra = [...bestByNetworkId.values()]
    .filter((n) => !input.allCoinIds.has(n.id))
    .sort((a, b) => {
      const left = `${a.name}|${a.id}`.toLowerCase()
      const right = `${b.name}|${b.id}`.toLowerCase()
      return left.localeCompare(right)
    })
  const ordered = [...canonical, ...extra]
  const mustKeepNetworkIds = new Set<string>(['doge', 'eth'])
  const withRequired = [...ordered]
  for (const requiredId of mustKeepNetworkIds) {
    if (withRequired.some((n) => n.id === requiredId)) continue
    const fallback = input.allNetworks.find((n) => n.id === requiredId)
    if (fallback) withRequired.push(fallback)
  }

  const filteredCatalog = catalog.filter((item) => item.kind !== 'main' || spendableMainCoinIds.has(item.coinId))
  return {
    networks: withRequired.length > 0 ? withRequired : null,
    catalog: filteredCatalog
  }
}
