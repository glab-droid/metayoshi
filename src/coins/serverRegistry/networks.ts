import type { Network } from '../types'
import type { NetworkCandidate, ServerCoinNetworkRow, ServerCoinRow } from './types'
import { EVM_MODEL_NETWORK_IDS, normalizeServerCoinSymbol, sanitizeServerCoinId } from './mappings'

export function resolveActiveServerNetwork(networks: ServerCoinNetworkRow[] | undefined): ServerCoinNetworkRow | null {
  const rows = Array.isArray(networks) ? networks.filter((n) => n && n.isActive !== false) : []
  if (rows.length === 0) return null
  const main = rows.find((n) => String(n.chain || '').trim().toLowerCase() === 'main')
  return main || rows[0] || null
}

function safeHost(value: string): string {
  try {
    return new URL(value).hostname.toLowerCase()
  } catch {
    return ''
  }
}

function isLoopbackOrPrivateHost(value: string): boolean {
  const host = safeHost(value)
  if (!host) return false
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return true
  if (host.startsWith('10.')) return true
  if (host.startsWith('192.168.')) return true
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(host)) return true
  return false
}

export function isPublicnodeNetworkRow(row: ServerCoinNetworkRow): boolean {
  const provider = String(row?.metadata?.provider || '').trim().toLowerCase()
  if (provider === 'publicnode') return true
  const url = String(row?.rpcUrl || '').trim().toLowerCase()
  return url.includes('publicnode.com')
}

function flattenServerMethodGroups(methodGroups: Record<string, string[]> | undefined): string[] {
  if (!methodGroups || typeof methodGroups !== 'object') return []
  const out: string[] = []
  for (const methods of Object.values(methodGroups)) {
    if (!Array.isArray(methods)) continue
    for (const method of methods) {
      const normalized = String(method || '').trim().toLowerCase()
      if (normalized) out.push(normalized)
    }
  }
  return out
}

export function supportsEvmBridgeMethods(methodGroups: Record<string, string[]> | undefined): boolean {
  const methods = flattenServerMethodGroups(methodGroups)
  if (methods.length === 0) return false
  return methods.some((m) => m.startsWith('eth_') || m === 'web3_clientversion' || m === 'net_version')
}

export function inferBridgeCapabilities(
  coinId: string,
  modelNetworkId: string | null,
  methodGroups: Record<string, string[]> | undefined,
  serverCapabilities?: ServerCoinRow['capabilities']
): Network['capabilities'] {
  const methods = new Set(flattenServerMethodGroups(methodGroups))
  const isEvmModel = Boolean(modelNetworkId && EVM_MODEL_NETWORK_IDS.has(modelNetworkId))
  const isRtm = coinId === 'raptoreum'
  const isCardano = coinId === 'cardano' || modelNetworkId === 'ada'

  const canSendCoin =
    serverCapabilities?.send === true
    || serverCapabilities?.broadcast === true
    methods.has('sendtoaddress')
    || methods.has('sendmany')
    || methods.has('eth_sendrawtransaction')
    || methods.has('submit')

  const assetLayer = isEvmModel || isRtm || isCardano
  const assetSend = isEvmModel || isRtm || isCardano || methods.has('sendasset')

  return {
    features: {
      nativeSend: canSendCoin,
      assetLayer,
      assetSend: assetLayer && assetSend,
      activity: true
    },
    ui: {
      showAssetsTab: assetLayer,
      showAssetsAction: assetLayer,
      showSendAction: canSendCoin,
      showActivityTab: true
    }
  }
}

export function mergeCapabilityInputs(
  baseCaps: Network['capabilities'] | undefined,
  inferredCaps: Network['capabilities'] | undefined
): Network['capabilities'] {
  const baseFeatures = baseCaps?.features || {}
  const baseUi = baseCaps?.ui || {}
  const inferredFeatures = inferredCaps?.features || {}
  const inferredUi = inferredCaps?.ui || {}

  const nativeSend = Boolean(baseFeatures.nativeSend || inferredFeatures.nativeSend)
  const assetLayer = Boolean(baseFeatures.assetLayer || inferredFeatures.assetLayer)
  const assetSend = Boolean(baseFeatures.assetSend || inferredFeatures.assetSend)
  const activity = Boolean(
    (baseFeatures.activity ?? true) || (inferredFeatures.activity ?? true)
  )

  return {
    features: {
      nativeSend,
      assetLayer,
      assetSend,
      activity
    },
    ui: {
      showAssetsTab: Boolean(baseUi.showAssetsTab || inferredUi.showAssetsTab || assetLayer),
      showAssetsAction: Boolean(baseUi.showAssetsAction || inferredUi.showAssetsAction || assetLayer),
      showSendAction: Boolean(baseUi.showSendAction || inferredUi.showSendAction || nativeSend),
      showActivityTab: Boolean((baseUi.showActivityTab ?? true) || (inferredUi.showActivityTab ?? true))
    }
  }
}

export function isNetworkSpendable(network: Network): boolean {
  if (network.derivation?.status === 'unsupported') return false
  return network.capabilities?.features?.nativeSend === true
}

export function scoreCandidate(candidate: NetworkCandidate): number {
  const rpcUrl = String(candidate.network.rpcUrl || '').trim().toLowerCase()
  const isHttps = rpcUrl.startsWith('https://')
  const isLocal = isLoopbackOrPrivateHost(rpcUrl)
  let score = 0
  if (candidate.isPublicnode) score += 120
  if (candidate.chain === 'main') score += 40
  if (isHttps) score += 20
  if (!isLocal) score += 15
  if (candidate.chain === 'test') score -= 10
  if (isLocal) score -= 25
  return score
}

export function resolveBridgeUrlForNetwork(
  apiBaseUrl: string,
  networkId: string,
  coinId: string,
  chain: 'main' | 'test',
  rpcWallet: string | undefined
): string {
  if (networkId === 'cro') {
    const resolvedCoinId = String(coinId || '').trim().toLowerCase() || 'cronos-pos'
    return `${apiBaseUrl}/v1/bridge/${resolvedCoinId}/${chain}`
  }
  if (networkId === 'rtm' || networkId === 'xrp') {
    const wallet = String(rpcWallet || '').trim() || 'mainwallet'
    return `${apiBaseUrl}/v1/bridge/${coinId}/${chain}/wallet/${encodeURIComponent(wallet)}`
  }
  return `${apiBaseUrl}/v1/bridge/${coinId}/${chain}`
}

export function createGenericServerNetwork(input: {
  apiBaseUrl: string
  defaultBridgeUser?: string
  defaultBridgePassword?: string
  coinId: string
  coin: ServerCoinRow
  chain: 'main' | 'test'
  selectedNetwork?: ServerCoinNetworkRow | null
}): Network {
  const suffix = sanitizeServerCoinId(input.coinId) || 'unknown'
  const symbol = normalizeServerCoinSymbol(
    input.coinId,
    String(input.coin.symbol || '').trim(),
    suffix.slice(0, 6)
  )
  const rpcWallet = String(input.selectedNetwork?.rpcWallet || '').trim()
  return {
    id: `generic--${suffix}`,
    runtimeModelId: 'generic',
    serverCoinId: input.coinId,
    serverChain: input.chain,
    name: String(input.coin.name || input.coinId).trim() || input.coinId,
    symbol,
    coinType: 'BTC',
    coinSymbol: symbol,
    rpcUrl: String(input.selectedNetwork?.rpcUrl || '').trim() || input.apiBaseUrl,
    rpcWallet: rpcWallet || '',
    rpcUsername: String(input.selectedNetwork?.rpcUser || '').trim(),
    rpcPassword: '',
    bridgeUrl: `${input.apiBaseUrl}/v1/bridge/${input.coinId}/${input.chain}`,
    bridgeUsername: input.defaultBridgeUser || undefined,
    bridgePassword: input.defaultBridgePassword || undefined,
    derivation: {
      status: 'unsupported',
      reason: `${input.coinId} address derivation is not supported in this build`
    },
    capabilities: {
      features: { nativeSend: false, assetLayer: false, assetSend: false, activity: true },
      ui: { showAssetsTab: false, showAssetsAction: false, showSendAction: false, showActivityTab: true }
    }
  }
}
