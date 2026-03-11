import type { CoinModule, CoinRuntimeContext, Network, NetworkCapabilitiesInput } from './types'
import { FULL_ASSET_CAPABILITIES, resolveBridgeCredentials } from './factories'
import { getUnifiedLogoByName } from './logos'

const DEFAULT_CRO_RPC_URL = 'https://cronos-pos-rpc.publicnode.com'
const DEFAULT_CRO_EXPLORER_URL = 'https://crypto.org/explorer'

export const CRO_CAPABILITIES: NetworkCapabilitiesInput = FULL_ASSET_CAPABILITIES

export function createCroNetwork(ctx: CoinRuntimeContext): Network {
  const env = (import.meta as any)?.env || {}
  const { bridgeUsername, bridgePassword } = resolveBridgeCredentials({
    userEnvKey: 'VITE_CRO_BRIDGE_USER',
    passEnvKey: 'VITE_CRO_BRIDGE_PASSWORD'
  })

  return {
    id: 'cro',
    runtimeModelId: 'cro',
    name: 'Cronos POS',
    symbol: 'CRO',
    coinType: 'COSMOS',
    coinSymbol: 'CRO',
    rpcUrl: String(env.VITE_CRO_RPC || DEFAULT_CRO_RPC_URL).trim() || DEFAULT_CRO_RPC_URL,
    rpcWallet: '',
    rpcUsername: String(env.VITE_CRO_RPC_USER || '').trim(),
    rpcPassword: String(env.VITE_CRO_RPC_PASSWORD || '').trim(),
    bridgeUrl: ctx.buildBridgeUrl('cronos-pos', 'main'),
    bridgeUsername,
    bridgePassword,
    explorerUrl: String(env.VITE_CRO_EXPLORER || DEFAULT_CRO_EXPLORER_URL).trim() || DEFAULT_CRO_EXPLORER_URL,
    capabilities: CRO_CAPABILITIES,
    logo: getUnifiedLogoByName('cronos')
  }
}

export const croCoin: CoinModule = {
  id: 'cro',
  symbol: 'CRO',
  coinSymbol: 'CRO',
  capabilities: CRO_CAPABILITIES,
  createNetwork: createCroNetwork
}
