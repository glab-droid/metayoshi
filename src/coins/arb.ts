import type { CoinModule, CoinRuntimeContext, Network, NetworkCapabilitiesInput } from './types'
import { createEvmCoinModule } from './factories'
import { getUnifiedLogoByName } from './logos'

const arbModule = createEvmCoinModule({
  id: 'arb',
  name: 'Arbitrum',
  symbol: 'ETH',
  coinSymbol: 'ETH',
  chainId: 42161,
  bridgeCoinId: 'arbitrum-one',
  logo: getUnifiedLogoByName('arbitrum'),
  rpcEnvKey: 'VITE_ARB_RPC',
  rpcUserEnvKey: 'VITE_ARB_RPC_USER',
  rpcPasswordEnvKey: 'VITE_ARB_RPC_PASSWORD',
  bridgeUserEnvKey: 'VITE_ARB_BRIDGE_USER',
  bridgePasswordEnvKey: 'VITE_ARB_BRIDGE_PASSWORD',
  explorerEnvKey: 'VITE_ARB_EXPLORER',
  defaultRpcUrl: 'https://arbitrum-one-rpc.publicnode.com',
  defaultExplorerUrl: 'https://arbiscan.io'
})

export const ARB_CAPABILITIES: NetworkCapabilitiesInput = arbModule.capabilities
export const createArbNetwork: (ctx: CoinRuntimeContext) => Network = arbModule.createNetwork
export const arbCoin: CoinModule = arbModule.coin
