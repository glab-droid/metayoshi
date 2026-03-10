import type {
  CoinModule,
  CoinRuntimeContext,
  Network,
  NetworkCapabilitiesInput,
  UtxoAddressSpec
} from './types'
import { FIRO_API_INFO } from './interceptors/firo'
import { getUnifiedLogoByName } from './logos'

export const FIRO_CAPABILITIES: NetworkCapabilitiesInput = {
  features: { nativeSend: true, assetLayer: false, assetSend: false, activity: true },
  ui: { showAssetsTab: false, showAssetsAction: false, showSendAction: true, showActivityTab: true }
}

export const FIRO_ADDRESS_SPEC: UtxoAddressSpec = {
  bip44CoinType: 136,
  p2pkhVersion: 0x52
}

export const FIRO_FEE_PER_BYTE = 0.00002

export function estimateFiroFee(txBytes: number): number {
  return txBytes * FIRO_FEE_PER_BYTE
}

export function createFiroNetwork(ctx: CoinRuntimeContext): Network {
  return {
    id: 'firo',
    name: 'Firo',
    symbol: 'FIRO',
    coinType: 'UTXO',
    coinSymbol: 'FIRO',
    rpcUrl: ctx.apiBaseUrl,
    rpcWallet: '',
    rpcUsername: 'rpcuser',
    rpcPassword: 'rpcpass',
    bridgeUrl: ctx.buildBridgeUrl('firo', 'main'),
    explorerUrl: import.meta.env.VITE_FIRO_EXPLORER || FIRO_API_INFO.defaultExplorerUrl || 'https://explorer.firo.org',
    capabilities: FIRO_CAPABILITIES,
    feePerByte: FIRO_FEE_PER_BYTE,
    logo: getUnifiedLogoByName('firo')
  }
}

export const firoCoin: CoinModule = {
  id: 'firo',
  symbol: 'FIRO',
  coinSymbol: 'FIRO',
  capabilities: FIRO_CAPABILITIES,
  utxoAddress: FIRO_ADDRESS_SPEC,
  createNetwork: createFiroNetwork,
  estimateFee: estimateFiroFee
}
