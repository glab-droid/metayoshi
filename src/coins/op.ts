import type { CoinModule, CoinRuntimeContext, Network, NetworkCapabilitiesInput } from './types'
import { createEvmCoinModule } from './factories'
import { getUnifiedLogoByName } from './logos'

const opModule = createEvmCoinModule({
  id: 'op',
  name: 'Optimism',
  symbol: 'ETH',
  coinSymbol: 'ETH',
  chainId: 10,
  bridgeCoinId: 'optimism',
  logo: getUnifiedLogoByName('op'),
  rpcEnvKey: 'VITE_OP_RPC',
  rpcUserEnvKey: 'VITE_OP_RPC_USER',
  rpcPasswordEnvKey: 'VITE_OP_RPC_PASSWORD',
  bridgeUserEnvKey: 'VITE_OP_BRIDGE_USER',
  bridgePasswordEnvKey: 'VITE_OP_BRIDGE_PASSWORD',
  explorerEnvKey: 'VITE_OP_EXPLORER',
  defaultRpcUrl: 'https://optimism-rpc.publicnode.com',
  defaultExplorerUrl: 'https://optimistic.etherscan.io'
})

export const OP_CAPABILITIES: NetworkCapabilitiesInput = opModule.capabilities
export const createOpNetwork: (ctx: CoinRuntimeContext) => Network = opModule.createNetwork
export const opCoin: CoinModule = opModule.coin
