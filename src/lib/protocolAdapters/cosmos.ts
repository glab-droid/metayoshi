import type { Network } from '../../coins'
import type { UtxoRpcConfig } from '../utxoRpc'
import { getCoinRuntimeProfile } from '../../coins'
import { isCosmosAddressForHrp, resolveCosmosAddressConfig } from '../cosmosAddress'
import { resolveRuntimeModelId } from '../runtimeModel'

function resolveModelId(network: Network): string {
  return resolveRuntimeModelId(network)
}

function deriveApiBaseFromBridgeUrl(bridgeUrl: string): string {
  const raw = String(bridgeUrl || '').trim().replace(/\/+$/, '')
  if (!raw) return ''
  const lower = raw.toLowerCase()
  const idxV1Bridge = lower.indexOf('/v1/bridge/')
  if (idxV1Bridge >= 0) return raw.slice(0, idxV1Bridge)
  const idxBridge = lower.indexOf('/bridge/')
  if (idxBridge >= 0) return raw.slice(0, idxBridge)
  if (/\/v1$/i.test(raw)) return raw.replace(/\/v1$/i, '')
  return raw
}

export function resolveCosmosNetworkConfig(network: Network): { hrp: string; decimals: number } {
  const cfg = resolveCosmosAddressConfig({
    runtimeModelId: resolveModelId(network),
    serverCoinId: String(network.serverCoinId || '').trim(),
    id: String(network.id || '').trim()
  })
  return { hrp: cfg.hrp, decimals: cfg.decimals }
}

export function isValidCosmosAddress(network: Network, value: string): boolean {
  const { hrp } = resolveCosmosNetworkConfig(network)
  return isCosmosAddressForHrp(value, hrp)
}

function resolveCosmosApiMeta(network: Network, rpcConfig?: UtxoRpcConfig): { apiBase: string; coin: string; chain: string } | null {
  const apiBase = deriveApiBaseFromBridgeUrl(String(rpcConfig?.bridgeUrl || ''))
  if (!apiBase) return null
  const modelId = String(resolveModelId(network) || network.id || '').trim().toLowerCase()
  const runtimeProfile = getCoinRuntimeProfile(modelId)
  const coin = String(
    network.serverCoinId
    || runtimeProfile?.coinId
    || modelId
  ).trim().toLowerCase()
  if (!coin) return null
  const chain = String(network.serverChain || 'main').trim().toLowerCase() || 'main'
  return { apiBase, coin, chain }
}

async function fetchCosmosStatus(network: Network, rpcConfig?: UtxoRpcConfig): Promise<{ syncPercent: number | null; isSyncing: boolean }> {
  const meta = resolveCosmosApiMeta(network, rpcConfig)
  if (!meta) return { syncPercent: null, isSyncing: false }
  try {
    const params = new URLSearchParams({ coin: meta.coin, chain: meta.chain })
    const response = await fetch(`${meta.apiBase}/v1/status?${params.toString()}`, { method: 'GET' })
    if (!response.ok) return { syncPercent: null, isSyncing: false }
    const json = await response.json().catch(() => null) as Record<string, unknown> | null
    const syncCandidates = [
      Number((json as any)?.syncPercent),
      Number((json as any)?.status?.syncPercent),
      Number((json as any)?.result?.syncPercent)
    ]
    const syncingRaw =
      (json as any)?.isSyncing
      ?? (json as any)?.syncing
      ?? (json as any)?.status?.isSyncing
      ?? (json as any)?.status?.syncing
      ?? (json as any)?.result?.isSyncing
      ?? (json as any)?.result?.syncing
    const syncPercentValue = syncCandidates.find((value) => Number.isFinite(value))
    const syncPercent = Number.isFinite(syncPercentValue)
      ? Math.max(0, Math.min(100, Number(syncPercentValue)))
      : null
    const isSyncing = typeof syncingRaw === 'boolean'
      ? syncingRaw
      : (syncPercent !== null ? syncPercent < 99.9 : false)
    return { syncPercent, isSyncing }
  } catch {
    return { syncPercent: null, isSyncing: false }
  }
}

async function fetchCosmosAddressBalance(network: Network, address: string, rpcConfig?: UtxoRpcConfig): Promise<string> {
  const meta = resolveCosmosApiMeta(network, rpcConfig)
  if (!meta) throw new Error('Cosmos API base URL is not available')
  const params = new URLSearchParams({ coin: meta.coin, chain: meta.chain })
  const response = await fetch(`${meta.apiBase}/v1/address/${encodeURIComponent(address)}/balance?${params.toString()}`, { method: 'GET' })
  if (!response.ok) {
    throw new Error(`Cosmos balance endpoint failed: HTTP ${response.status}`)
  }
  const json = await response.json().catch(() => null) as Record<string, unknown> | null
  const balance =
    String((json as any)?.balance ?? (json as any)?.result?.balance ?? '').trim()
  if (!balance || !/^\d+(\.\d+)?$/.test(balance)) {
    throw new Error('Cosmos balance endpoint returned an invalid balance payload')
  }
  return balance
}

export async function fetchCosmosBalanceAndSync(
  network: Network,
  address: string,
  rpcConfig: UtxoRpcConfig
): Promise<{ balance: string; syncPercent: number | null; isSyncing: boolean }> {
  const [status, balance] = await Promise.all([
    fetchCosmosStatus(network, rpcConfig),
    fetchCosmosAddressBalance(network, address, rpcConfig)
  ])
  return { balance, syncPercent: status.syncPercent, isSyncing: status.isSyncing }
}
