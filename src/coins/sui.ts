import type { CoinModule, CoinRuntimeContext, Network, NetworkCapabilitiesInput } from './types'
import { resolveBridgeCredentials } from './factories'
import { getUnifiedLogoByName } from './logos'

export const SUI_CAPABILITIES: NetworkCapabilitiesInput = {
  features: { nativeSend: false, assetLayer: false, assetSend: false, activity: true },
  ui: { showAssetsTab: false, showAssetsAction: false, showSendAction: false, showActivityTab: true }
}

export function createSuiNetwork(ctx: CoinRuntimeContext): Network {
  const env = (import.meta as any)?.env || {}
  const { bridgeUsername, bridgePassword } = resolveBridgeCredentials({
    userEnvKey: 'VITE_SUI_BRIDGE_USER',
    passEnvKey: 'VITE_SUI_BRIDGE_PASSWORD'
  })
  return {
    id: 'sui',
    runtimeModelId: 'sui',
    name: 'Sui',
    symbol: 'SUI',
    coinType: 'SUI',
    coinSymbol: 'SUI',
    rpcUrl: String(env.VITE_SUI_RPC || 'https://sui-rpc.publicnode.com').trim() || 'https://sui-rpc.publicnode.com',
    rpcWallet: '',
    rpcUsername: String(env.VITE_SUI_RPC_USER || '').trim(),
    rpcPassword: String(env.VITE_SUI_RPC_PASSWORD || '').trim(),
    bridgeUrl: ctx.buildBridgeUrl('sui', 'main'),
    bridgeUsername,
    bridgePassword,
    explorerUrl: String(env.VITE_SUI_EXPLORER || 'https://suiscan.xyz/mainnet').trim() || 'https://suiscan.xyz/mainnet',
    capabilities: SUI_CAPABILITIES,
    derivation: {
      status: 'supported'
    },
    logo: getUnifiedLogoByName('sui')
  }
}

export const suiCoin: CoinModule = {
  id: 'sui',
  symbol: 'SUI',
  coinSymbol: 'SUI',
  capabilities: SUI_CAPABILITIES,
  createNetwork: createSuiNetwork
}
