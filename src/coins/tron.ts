import type { CoinModule, CoinRuntimeContext, Network } from './types'
import { FULL_ASSET_CAPABILITIES, resolveBridgeCredentials } from './factories'
import { getUnifiedLogoByName } from './logos'

const DEFAULT_TRON_RPC_URL = 'https://api.trongrid.io'
const DEFAULT_TRON_EXPLORER_URL = 'https://tronscan.org/#/'

export function createTronNetwork(ctx: CoinRuntimeContext): Network {
  const env = (import.meta as any)?.env || {}
  const { bridgeUsername, bridgePassword } = resolveBridgeCredentials({
    userEnvKey: 'VITE_TRON_BRIDGE_USER',
    passEnvKey: 'VITE_TRON_BRIDGE_PASSWORD'
  })

  return {
    id: 'tron',
    runtimeModelId: 'tron',
    serverCoinId: 'tron',
    serverChain: 'main',
    name: 'TRON',
    symbol: 'TRX',
    coinType: 'BTC',
    coinSymbol: 'TRX',
    rpcUrl: String(env.VITE_TRON_RPC || DEFAULT_TRON_RPC_URL).trim() || DEFAULT_TRON_RPC_URL,
    rpcWallet: '',
    rpcUsername: String(env.VITE_TRON_RPC_USER || '').trim(),
    rpcPassword: String(env.VITE_TRON_RPC_PASSWORD || '').trim(),
    bridgeUrl: ctx.buildBridgeUrl('tron', 'main'),
    bridgeUsername,
    bridgePassword,
    explorerUrl: String(env.VITE_TRON_EXPLORER || DEFAULT_TRON_EXPLORER_URL).trim() || DEFAULT_TRON_EXPLORER_URL,
    capabilities: FULL_ASSET_CAPABILITIES,
    derivation: {
      status: 'supported'
    },
    logo: getUnifiedLogoByName('tron')
  }
}

export const tronCoin: CoinModule = {
  id: 'tron',
  symbol: 'TRX',
  coinSymbol: 'TRX',
  capabilities: FULL_ASSET_CAPABILITIES,
  createNetwork: createTronNetwork
}
