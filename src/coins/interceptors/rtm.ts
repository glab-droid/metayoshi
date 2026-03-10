import { createCoinApiInterceptor } from './factory'
import type { CoinApiInfo } from './types'
import { RTM_PAYLOADS } from '../payloads'

// RTM mainnet API profile and transport interceptor.
const DEFAULT_API_BASE = 'https://api.metayoshi.app'
const DEFAULT_WALLET = 'mainwallet'

const apiBaseUrl = String((import.meta as any)?.env?.VITE_API_BASE_URL || DEFAULT_API_BASE).trim().replace(/\/+$/, '')
const wallet = String(import.meta.env.VITE_RTM_WALLET || DEFAULT_WALLET).trim() || DEFAULT_WALLET
const defaultBridgeUrl = `${apiBaseUrl}/v1/bridge/raptoreum/main/wallet/${encodeURIComponent(wallet)}`

export const RTM_API_INFO: CoinApiInfo = {
  networkId: 'rtm',
  symbol: 'RTM',
  coinId: 'raptoreum',
  chain: 'main',
  protocol: 'utxo-jsonrpc',
  apiBaseUrl,
  defaultRpcUrl: apiBaseUrl,
  defaultBridgeUrl,
  defaultWallet: wallet,
  defaultExplorerUrl: 'https://explorer.raptoreum.com',
  healthUrl: `${apiBaseUrl}/health`,
  bridgeMethodsUrl: `${apiBaseUrl}/v1/bridge/methods/raptoreum`,
  sendCoinPathTemplate: '/v1/bridge/send/coin/raptoreum/main/:wallet',
  sendAssetPathTemplate: '/v1/bridge/send/asset/raptoreum/main/:wallet',
  payloads: RTM_PAYLOADS
}

export const rtmApiInterceptor = createCoinApiInterceptor(RTM_API_INFO)
