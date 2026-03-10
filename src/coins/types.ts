import type { NetworkCapabilitiesInput } from '../lib/networkCapabilities'
export type { NetworkCapabilitiesInput } from '../lib/networkCapabilities'

export type CoinType = 'EVM' | 'UTXO' | 'BTC' | 'SOL' | 'COSMOS' | 'SUI'

export interface NetworkDerivationSupport {
  status: 'supported' | 'unsupported'
  /** Human-readable reason shown in UI when derivation is unavailable. */
  reason?: string
}

export interface Network {
  id: string
  /** Canonical app runtime model id (e.g. eth, doge, cosmos) for dynamic server-mapped networks. */
  runtimeModelId?: string
  /** Original server coin id from /v1/coins when network was loaded dynamically. */
  serverCoinId?: string
  /** Original server chain id from /v1/coins (main/test). */
  serverChain?: 'main' | 'test'
  name: string
  symbol: string
  coinType: CoinType
  chainId?: number

  // ── Local / direct RPC ──────────────────────────────────────────────────
  rpcUrl: string
  rpcWallet?: string
  rpcUsername?: string
  rpcPassword?: string

  // ── Public bridge gateway (*.metayoshi.app) ─────────────────────────────
  bridgeUrl?: string
  bridgeUsername?: string
  bridgePassword?: string

  explorerUrl?: string
  coinSymbol?: string
  supportsAssets?: boolean
  capabilities?: NetworkCapabilitiesInput
  /** Coin logo URL/path (public path or imported asset URL). */
  logo?: string
  /** Per-network seed-derivation support status. */
  derivation?: NetworkDerivationSupport

  // UTXO fee estimate in coin units per byte.
  feePerByte?: number
}

export interface UtxoAddressSpec {
  bip44CoinType: number
  p2pkhVersion: number | number[]
}

export interface CoinRuntimeContext {
  apiBaseUrl: string
  buildBridgeUrl: (coin: string, chain: 'main' | 'test', wallet?: string) => string
}

export interface CoinModule {
  id: string
  symbol: string
  coinSymbol?: string
  capabilities: NetworkCapabilitiesInput
  utxoAddress?: UtxoAddressSpec
  createNetwork: (ctx: CoinRuntimeContext) => Network
  estimateFee?: (txBytes: number) => number
}
