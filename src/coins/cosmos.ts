import type { CoinModule, CoinRuntimeContext, Network, NetworkCapabilitiesInput } from './types'
import { FULL_ASSET_CAPABILITIES, resolveBridgeCredentials } from './factories'
import { getUnifiedLogoByName } from './logos'

const DEFAULT_COSMOS_RPC_URL = 'https://cosmos-rpc.publicnode.com'
const DEFAULT_COSMOS_EXPLORER_URL = 'https://www.mintscan.io/cosmos'

export const COSMOS_CAPABILITIES: NetworkCapabilitiesInput = FULL_ASSET_CAPABILITIES

export function createCosmosNetwork(ctx: CoinRuntimeContext): Network {
  const env = (import.meta as any)?.env || {}
  const { bridgeUsername, bridgePassword } = resolveBridgeCredentials({
    userEnvKey: 'VITE_COSMOS_BRIDGE_USER',
    passEnvKey: 'VITE_COSMOS_BRIDGE_PASSWORD'
  })

  return {
    id: 'cosmos',
    runtimeModelId: 'cosmos',
    name: 'Cosmos Hub',
    symbol: 'ATOM',
    coinType: 'COSMOS',
    coinSymbol: 'ATOM',
    rpcUrl: String(env.VITE_COSMOS_RPC || DEFAULT_COSMOS_RPC_URL).trim() || DEFAULT_COSMOS_RPC_URL,
    rpcWallet: '',
    rpcUsername: String(env.VITE_COSMOS_RPC_USER || '').trim(),
    rpcPassword: String(env.VITE_COSMOS_RPC_PASSWORD || '').trim(),
    bridgeUrl: ctx.buildBridgeUrl('cosmos', 'main'),
    bridgeUsername,
    bridgePassword,
    explorerUrl: String(env.VITE_COSMOS_EXPLORER || DEFAULT_COSMOS_EXPLORER_URL).trim() || DEFAULT_COSMOS_EXPLORER_URL,
    capabilities: COSMOS_CAPABILITIES,
    logo: getUnifiedLogoByName('cosmos')
  }
}

export const cosmosCoin: CoinModule = {
  id: 'cosmos',
  symbol: 'ATOM',
  coinSymbol: 'ATOM',
  capabilities: COSMOS_CAPABILITIES,
  createNetwork: createCosmosNetwork
}
