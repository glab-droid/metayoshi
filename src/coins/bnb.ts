import type { CoinModule, CoinRuntimeContext, Network, NetworkCapabilitiesInput } from './types'
import { createEvmCoinModule } from './factories'
import { getUnifiedLogoByName } from './logos'

const bnbModule = createEvmCoinModule({
  id: 'bnb',
  name: 'BSC Mainnet',
  symbol: 'BNB',
  coinSymbol: 'BNB',
  chainId: 56,
  bridgeCoinId: 'bsc',
  logo: getUnifiedLogoByName('bnb'),
  rpcEnvKey: 'VITE_BSC_RPC',
  rpcUserEnvKey: 'VITE_BSC_RPC_USER',
  rpcPasswordEnvKey: 'VITE_BSC_RPC_PASSWORD',
  bridgeUserEnvKey: 'VITE_BSC_BRIDGE_USER',
  bridgePasswordEnvKey: 'VITE_BSC_BRIDGE_PASSWORD',
  explorerEnvKey: 'VITE_BSC_EXPLORER',
  defaultRpcUrl: 'https://bsc-dataseed.bnbchain.org',
  defaultExplorerUrl: 'https://bscscan.com'
})

export const BNB_CAPABILITIES: NetworkCapabilitiesInput = bnbModule.capabilities
export const createBnbNetwork: (ctx: CoinRuntimeContext) => Network = bnbModule.createNetwork
export const bnbCoin: CoinModule = bnbModule.coin
