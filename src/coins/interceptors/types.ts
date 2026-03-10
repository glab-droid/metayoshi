import type { CoinPayloadCatalog } from '../payloads/types'
export type CoinChain = 'main' | 'test'
export type CoinRpcProtocol =
  | 'utxo-jsonrpc'
  | 'evm-jsonrpc'
  | 'cardano-wallet-compat'
  | 'cosmos-rest-bridge'

/** Static API metadata per coin/network.
 *  This is the single source of truth for bridge endpoints and defaults. */
export interface CoinApiInfo {
  networkId: string
  symbol: string
  coinId: string
  chain: CoinChain
  protocol?: CoinRpcProtocol
  apiBaseUrl: string
  defaultRpcUrl: string
  defaultBridgeUrl: string
  defaultWallet?: string
  defaultExplorerUrl?: string
  healthUrl: string
  bridgeMethodsUrl: string
  sendCoinPathTemplate: string
  sendAssetPathTemplate: string
  payloads?: CoinPayloadCatalog
}

export interface RpcInterceptorRequest {
  url: string
  method: string
  params: unknown[]
  headers: Record<string, string>
  body: string
  timeoutMs: number
}

export interface RpcInterceptorResponse {
  url: string
  method: string
  params: unknown[]
  status: number
  payload: unknown
}

export type RpcInterceptorErrorPhase = 'request' | 'transport' | 'http' | 'parse' | 'rpc'

export interface RpcInterceptorErrorContext {
  url: string
  method: string
  params: unknown[]
  phase: RpcInterceptorErrorPhase
  error: unknown
}

export interface CoinApiInterceptor {
  info: CoinApiInfo
  onRequest?: (request: RpcInterceptorRequest) => RpcInterceptorRequest | Promise<RpcInterceptorRequest>
  onResponse?: (response: RpcInterceptorResponse) => unknown | Promise<unknown>
  onError?: (ctx: RpcInterceptorErrorContext) => Error
}
