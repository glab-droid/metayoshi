import { createCoinApiInterceptor } from './factory'
import type { CoinApiInfo } from './types'
import { DASH_PAYLOADS } from '../payloads'

const DEFAULT_API_BASE = 'https://api.metayoshi.app'
const apiBaseUrl = String((import.meta as any)?.env?.VITE_API_BASE_URL || DEFAULT_API_BASE).trim().replace(/\/+$/, '')
const defaultBridgeUrl = `${apiBaseUrl}/v1/bridge/dash/main`

export const DASH_API_INFO: CoinApiInfo = {
  networkId: 'dash',
  symbol: 'DASH',
  coinId: 'dash',
  chain: 'main',
  protocol: 'utxo-jsonrpc',
  apiBaseUrl,
  defaultRpcUrl: apiBaseUrl,
  defaultBridgeUrl,
  defaultExplorerUrl: 'https://insight.dash.org/insight',
  healthUrl: `${apiBaseUrl}/health`,
  bridgeMethodsUrl: `${apiBaseUrl}/v1/bridge/methods/dash`,
  sendCoinPathTemplate: '/v1/bridge/send/coin/dash/main/:wallet',
  sendAssetPathTemplate: '/v1/bridge/send/asset/dash/main/:wallet',
  payloads: DASH_PAYLOADS
}

export const dashApiInterceptor = createCoinApiInterceptor(DASH_API_INFO)
