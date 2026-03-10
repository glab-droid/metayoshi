import type {
  CoinModule,
  CoinRuntimeContext,
  Network,
  NetworkCapabilitiesInput,
  UtxoAddressSpec
} from './types'
import { resolveBridgeCredentials } from './factories'
import { getUnifiedLogoByName } from './logos'

export const BTC_CAPABILITIES: NetworkCapabilitiesInput = {
  features: { nativeSend: true, assetLayer: false, assetSend: false, activity: true },
  ui: { showAssetsTab: false, showAssetsAction: false, showSendAction: true, showActivityTab: true }
}

export const BTC_ADDRESS_SPEC: UtxoAddressSpec = {
  bip44CoinType: 0,
  p2pkhVersion: 0x00
}

export const BTC_FEE_PER_BYTE = 0.00002

export function estimateBtcFee(txBytes: number): number {
  return txBytes * BTC_FEE_PER_BYTE
}

export function createBtcNetwork(ctx: CoinRuntimeContext): Network {
  const env = (import.meta as any)?.env || {}
  const { bridgeUsername, bridgePassword } = resolveBridgeCredentials({
    userEnvKey: 'VITE_BTC_BRIDGE_USER',
    passEnvKey: 'VITE_BTC_BRIDGE_PASSWORD'
  })

  return {
    id: 'srv--bitcoin',
    runtimeModelId: 'srv--bitcoin',
    name: 'Bitcoin',
    symbol: 'BTC',
    coinType: 'UTXO',
    coinSymbol: 'BTC',
    rpcUrl: ctx.apiBaseUrl,
    rpcUsername: String(env.VITE_BTC_RPC_USER || '').trim(),
    rpcPassword: String(env.VITE_BTC_RPC_PASSWORD || '').trim(),
    bridgeUrl: ctx.buildBridgeUrl('bitcoin', 'main'),
    bridgeUsername,
    bridgePassword,
    explorerUrl: String(import.meta.env.VITE_BTC_EXPLORER || 'https://mempool.space').trim(),
    capabilities: BTC_CAPABILITIES,
    feePerByte: BTC_FEE_PER_BYTE,
    logo: getUnifiedLogoByName('bitcoin')
  }
}

export const btcCoin: CoinModule = {
  id: 'srv--bitcoin',
  symbol: 'BTC',
  coinSymbol: 'BTC',
  capabilities: BTC_CAPABILITIES,
  utxoAddress: BTC_ADDRESS_SPEC,
  createNetwork: createBtcNetwork,
  estimateFee: estimateBtcFee
}
