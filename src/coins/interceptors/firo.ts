import { createCoinApiInterceptor } from './factory'
import type { CoinApiInfo } from './types'
import { FIRO_PAYLOADS } from '../payloads/firo'

const DEFAULT_API_BASE = 'https://api.metayoshi.app'
const apiBaseUrl = String((import.meta as any)?.env?.VITE_API_BASE_URL || DEFAULT_API_BASE).trim().replace(/\/+$/, '')
const defaultBridgeUrl = `${apiBaseUrl}/v1/bridge/firo/main`

export const FIRO_API_INFO: CoinApiInfo = {
  networkId: 'firo',
  symbol: 'FIRO',
  coinId: 'firo',
  chain: 'main',
  protocol: 'utxo-jsonrpc',
  apiBaseUrl,
  defaultRpcUrl: apiBaseUrl,
  defaultBridgeUrl,
  defaultExplorerUrl: 'https://explorer.firo.org',
  healthUrl: `${apiBaseUrl}/health`,
  bridgeMethodsUrl: `${apiBaseUrl}/v1/bridge/methods/firo`,
  sendCoinPathTemplate: '/v1/bridge/send/coin/firo/main/:wallet',
  sendAssetPathTemplate: '/v1/bridge/send/asset/firo/main/:wallet',
  payloads: FIRO_PAYLOADS
}

export const firoApiInterceptor = createCoinApiInterceptor(FIRO_API_INFO)
