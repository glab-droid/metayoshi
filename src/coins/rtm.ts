import type {
  CoinModule,
  CoinRuntimeContext,
  Network,
  NetworkCapabilitiesInput,
  UtxoAddressSpec
} from './types'
import { RTM_API_INFO } from './interceptors'
import { getUnifiedLogoByName } from './logos'

export const RTM_CAPABILITIES: NetworkCapabilitiesInput = {
  features: { nativeSend: true, assetLayer: true, assetSend: true, activity: true },
  ui: { showAssetsTab: true, showAssetsAction: true, showSendAction: true, showActivityTab: true }
}

export const RTM_ADDRESS_SPEC: UtxoAddressSpec = {
  bip44CoinType: 175,
  p2pkhVersion: 0x3c
}

// RTM relay fee baseline is ~0.0001 RTM/kB. We keep a conservative margin.
export const RTM_FEE_PER_BYTE = 0.00002

export function estimateRtmFee(txBytes: number): number {
  return txBytes * RTM_FEE_PER_BYTE
}

export function createRtmNetwork(ctx: CoinRuntimeContext): Network {
  const wallet = import.meta.env.VITE_RTM_WALLET || RTM_API_INFO.defaultWallet || 'mainwallet'
  return {
    id: 'rtm',
    name: 'Raptoreum',
    symbol: 'RTM',
    coinType: 'UTXO',
    coinSymbol: 'RTM',
    rpcUrl: ctx.apiBaseUrl,
    rpcWallet: wallet,
    rpcUsername: 'rpcuser',
    rpcPassword: 'rpcpass',
    bridgeUrl: ctx.buildBridgeUrl('raptoreum', 'main', wallet),
    explorerUrl: import.meta.env.VITE_RTM_EXPLORER || RTM_API_INFO.defaultExplorerUrl || 'https://explorer.raptoreum.com',
    capabilities: RTM_CAPABILITIES,
    feePerByte: RTM_FEE_PER_BYTE,
    logo: getUnifiedLogoByName('raptoreum')
  }
}

export const rtmCoin: CoinModule = {
  id: 'rtm',
  symbol: 'RTM',
  coinSymbol: 'RTM',
  capabilities: RTM_CAPABILITIES,
  utxoAddress: RTM_ADDRESS_SPEC,
  createNetwork: createRtmNetwork,
  estimateFee: estimateRtmFee
}
