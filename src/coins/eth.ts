import type { CoinModule, CoinRuntimeContext, Network, NetworkCapabilitiesInput } from './types'
import { createEvmCoinModule } from './factories'
import { getUnifiedLogoByName } from './logos'

const ethModule = createEvmCoinModule({
  id: 'eth',
  name: 'Ethereum',
  symbol: 'ETH',
  coinSymbol: 'ETH',
  chainId: 1,
  bridgeCoinId: 'ethereum',
  logo: getUnifiedLogoByName('ethereum'),
  rpcEnvKey: 'VITE_ETH_RPC',
  rpcUserEnvKey: 'VITE_ETH_RPC_USER',
  rpcPasswordEnvKey: 'VITE_ETH_RPC_PASSWORD',
  bridgeUserEnvKey: 'VITE_ETH_BRIDGE_USER',
  bridgePasswordEnvKey: 'VITE_ETH_BRIDGE_PASSWORD',
  explorerEnvKey: 'VITE_ETH_EXPLORER',
  defaultRpcUrl: 'https://ethereum-rpc.publicnode.com',
  defaultExplorerUrl: 'https://etherscan.io'
})

export const ETH_CAPABILITIES: NetworkCapabilitiesInput = ethModule.capabilities
export const createEthNetwork: (ctx: CoinRuntimeContext) => Network = ethModule.createNetwork
export const ethCoin: CoinModule = ethModule.coin
