import type { CoinModule, CoinRuntimeContext, Network, NetworkCapabilitiesInput, UtxoAddressSpec } from './types'
import { NATIVE_ONLY_CAPABILITIES, resolveBridgeCredentials } from './factories'
import { DASH_API_INFO } from './interceptors/dash'
import { getUnifiedLogoByName } from './logos'

export const DASH_CAPABILITIES: NetworkCapabilitiesInput = NATIVE_ONLY_CAPABILITIES
export const DASH_ADDRESS_SPEC: UtxoAddressSpec = {
  bip44CoinType: 5,
  p2pkhVersion: 0x4c
}

export const DASH_FEE_PER_BYTE = 0.00002

export function estimateDashFee(txBytes: number): number {
  return txBytes * DASH_FEE_PER_BYTE
}

export function createDashNetwork(ctx: CoinRuntimeContext): Network {
  const { bridgeUsername, bridgePassword } = resolveBridgeCredentials()
  return {
    id: 'dash',
    runtimeModelId: 'dash',
    serverCoinId: 'dash',
    serverChain: 'main',
    name: 'Dash',
    symbol: 'DASH',
    coinType: 'UTXO',
    coinSymbol: 'DASH',
    rpcUrl: ctx.apiBaseUrl,
    rpcWallet: '',
    rpcUsername: '',
    rpcPassword: '',
    bridgeUrl: ctx.buildBridgeUrl('dash', 'main'),
    bridgeUsername,
    bridgePassword,
    explorerUrl: import.meta.env.VITE_DASH_EXPLORER || DASH_API_INFO.defaultExplorerUrl || 'https://insight.dash.org/insight',
    capabilities: DASH_CAPABILITIES,
    feePerByte: DASH_FEE_PER_BYTE,
    logo: getUnifiedLogoByName('dash')
  }
}

export const dashCoin: CoinModule = {
  id: 'dash',
  symbol: 'DASH',
  coinSymbol: 'DASH',
  capabilities: DASH_CAPABILITIES,
  utxoAddress: DASH_ADDRESS_SPEC,
  createNetwork: createDashNetwork,
  estimateFee: estimateDashFee
}

