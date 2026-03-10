import type { Network } from '../types'

export type ServerCoinNetworkRow = {
  chain?: string
  rpcUrl?: string
  rpcWallet?: string
  rpcUser?: string
  isActive?: boolean
  metadata?: {
    provider?: string
    [key: string]: unknown
  }
}

export type ServerCoinRow = {
  coinId?: string
  id?: string
  name?: string
  symbol?: string
  chain?: string
  enabled?: boolean
  bridgeImplemented?: boolean
  capabilities?: {
    rpcBridge?: boolean
    sync?: boolean
    balance?: boolean
    assets?: boolean
    history?: boolean
    send?: boolean
    broadcast?: boolean
  }
  features?: { bridge?: boolean }
  methodGroups?: Record<string, string[]>
  networks?: ServerCoinNetworkRow[]
}

export type ServerCoinCatalogKind = 'main' | 'asset'

export type ServerCoinCatalogItem = {
  coinId: string
  name: string
  symbol: string
  kind: ServerCoinCatalogKind
  contractAddress?: string
  runtimeModelId: string | null
  appNetworkId: string | null
  chain: 'main' | 'test'
}

export type NetworkCandidate = {
  appNetworkId: string
  network: Network
  chain: 'main' | 'test'
  isPublicnode: boolean
}

export function resolveServerCoinId(coin: ServerCoinRow): string {
  return String(coin.coinId || coin.id || '').trim().toLowerCase()
}

export function isServerCoinBridgeEnabled(coin: ServerCoinRow): boolean {
  if (coin?.features?.bridge === false) return false
  if (coin?.bridgeImplemented === false) return false
  if (coin?.capabilities?.rpcBridge === false) return false
  return true
}

export function resolveServerCoinChain(
  coin: ServerCoinRow,
  selectedNetwork?: ServerCoinNetworkRow | null
): 'main' | 'test' {
  const selectedChain = String(selectedNetwork?.chain || '').trim().toLowerCase()
  if (selectedChain === 'main' || selectedChain === 'test') return selectedChain
  return String(coin.chain || '').trim().toLowerCase() === 'test' ? 'test' : 'main'
}
