import type { CoinModule, CoinRuntimeContext, Network } from './types'
import { FULL_ASSET_CAPABILITIES, resolveBridgeCredentials } from './factories'
import { getUnifiedLogoByName } from './logos'

const DEFAULT_ADA_RPC_URL = 'https://api.koios.rest/api/v1'
const DEFAULT_ADA_EXPLORER_URL = 'https://cardanoscan.io'

export function createAdaNetwork(ctx: CoinRuntimeContext): Network {
  const env = (import.meta as any)?.env || {}
  const { bridgeUsername, bridgePassword } = resolveBridgeCredentials({
    userEnvKey: 'VITE_ADA_BRIDGE_USER',
    passEnvKey: 'VITE_ADA_BRIDGE_PASSWORD'
  })

  return {
    id: 'ada',
    runtimeModelId: 'ada',
    serverCoinId: 'cardano',
    serverChain: 'main',
    name: 'Cardano',
    symbol: 'ADA',
    coinType: 'BTC',
    coinSymbol: 'ADA',
    rpcUrl: String(env.VITE_ADA_RPC || DEFAULT_ADA_RPC_URL).trim() || DEFAULT_ADA_RPC_URL,
    rpcWallet: '',
    rpcUsername: String(env.VITE_ADA_RPC_USER || '').trim(),
    rpcPassword: String(env.VITE_ADA_RPC_PASSWORD || '').trim(),
    bridgeUrl: ctx.buildBridgeUrl('cardano', 'main'),
    bridgeUsername,
    bridgePassword,
    explorerUrl: String(env.VITE_ADA_EXPLORER || DEFAULT_ADA_EXPLORER_URL).trim() || DEFAULT_ADA_EXPLORER_URL,
    capabilities: FULL_ASSET_CAPABILITIES,
    derivation: {
      status: 'supported'
    },
    logo: getUnifiedLogoByName('cardano')
  }
}

export const adaCoin: CoinModule = {
  id: 'ada',
  symbol: 'ADA',
  coinSymbol: 'ADA',
  capabilities: FULL_ASSET_CAPABILITIES,
  createNetwork: createAdaNetwork
}
