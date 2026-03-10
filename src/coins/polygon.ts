import type { CoinModule, CoinRuntimeContext, Network, NetworkCapabilitiesInput } from './types'
import { createEvmCoinModule } from './factories'
import { getUnifiedLogoByName } from './logos'

const polygonModule = createEvmCoinModule({
  id: 'polygon',
  name: 'Polygon',
  symbol: 'MATIC',
  coinSymbol: 'MATIC',
  chainId: 137,
  bridgeCoinId: 'polygon-bor',
  logo: getUnifiedLogoByName('polygon'),
  rpcEnvKey: 'VITE_POLYGON_RPC',
  rpcUserEnvKey: 'VITE_POLYGON_RPC_USER',
  rpcPasswordEnvKey: 'VITE_POLYGON_RPC_PASSWORD',
  bridgeUserEnvKey: 'VITE_POLYGON_BRIDGE_USER',
  bridgePasswordEnvKey: 'VITE_POLYGON_BRIDGE_PASSWORD',
  explorerEnvKey: 'VITE_POLYGON_EXPLORER',
  defaultRpcUrl: 'https://polygon-bor-rpc.publicnode.com',
  defaultExplorerUrl: 'https://polygonscan.com'
})

export const POLYGON_CAPABILITIES: NetworkCapabilitiesInput = polygonModule.capabilities
export const createPolygonNetwork: (ctx: CoinRuntimeContext) => Network = polygonModule.createNetwork
export const polygonCoin: CoinModule = polygonModule.coin
