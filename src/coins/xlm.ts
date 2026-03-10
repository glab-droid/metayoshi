import type { CoinModule, CoinRuntimeContext, Network } from './types'
import { NATIVE_ONLY_CAPABILITIES, resolveBridgeCredentials } from './factories'
import { getUnifiedLogoByName } from './logos'

const DEFAULT_XLM_RPC_URL = 'https://horizon.stellar.org'
const DEFAULT_XLM_EXPLORER_URL = 'https://stellar.expert/explorer/public'

export function createXlmNetwork(ctx: CoinRuntimeContext): Network {
  const env = (import.meta as any)?.env || {}
  const { bridgeUsername, bridgePassword } = resolveBridgeCredentials({
    userEnvKey: 'VITE_XLM_BRIDGE_USER',
    passEnvKey: 'VITE_XLM_BRIDGE_PASSWORD'
  })

  return {
    id: 'xlm',
    runtimeModelId: 'xlm',
    serverCoinId: 'stellar',
    serverChain: 'main',
    name: 'Stellar',
    symbol: 'XLM',
    coinType: 'BTC',
    coinSymbol: 'XLM',
    rpcUrl: String(env.VITE_XLM_RPC || DEFAULT_XLM_RPC_URL).trim() || DEFAULT_XLM_RPC_URL,
    rpcWallet: '',
    rpcUsername: String(env.VITE_XLM_RPC_USER || '').trim(),
    rpcPassword: String(env.VITE_XLM_RPC_PASSWORD || '').trim(),
    bridgeUrl: ctx.buildBridgeUrl('stellar', 'main'),
    bridgeUsername,
    bridgePassword,
    explorerUrl: String(env.VITE_XLM_EXPLORER || DEFAULT_XLM_EXPLORER_URL).trim() || DEFAULT_XLM_EXPLORER_URL,
    capabilities: NATIVE_ONLY_CAPABILITIES,
    derivation: {
      status: 'supported'
    },
    logo: getUnifiedLogoByName('stellar')
  }
}

export const xlmCoin: CoinModule = {
  id: 'xlm',
  symbol: 'XLM',
  coinSymbol: 'XLM',
  capabilities: NATIVE_ONLY_CAPABILITIES,
  createNetwork: createXlmNetwork
}
