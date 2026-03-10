import type { CoinModule, CoinRuntimeContext, Network, NetworkCapabilitiesInput } from './types'
import { createEvmCoinModule } from './factories'
import { getUnifiedLogoByName } from './logos'

const zksyncModule = createEvmCoinModule({
  id: 'zksync',
  name: 'zkSync Era',
  symbol: 'ETH',
  coinSymbol: 'ETH',
  chainId: 324,
  bridgeCoinId: 'zksync-era',
  logo: getUnifiedLogoByName('zksync'),
  rpcEnvKey: 'VITE_ZKSYNC_RPC',
  rpcUserEnvKey: 'VITE_ZKSYNC_RPC_USER',
  rpcPasswordEnvKey: 'VITE_ZKSYNC_RPC_PASSWORD',
  bridgeUserEnvKey: 'VITE_ZKSYNC_BRIDGE_USER',
  bridgePasswordEnvKey: 'VITE_ZKSYNC_BRIDGE_PASSWORD',
  explorerEnvKey: 'VITE_ZKSYNC_EXPLORER',
  defaultRpcUrl: 'https://mainnet.era.zksync.io',
  defaultExplorerUrl: 'https://explorer.zksync.io'
})

export const ZKSYNC_CAPABILITIES: NetworkCapabilitiesInput = zksyncModule.capabilities
export const createZkSyncNetwork: (ctx: CoinRuntimeContext) => Network = zksyncModule.createNetwork
export const zksyncCoin: CoinModule = zksyncModule.coin
