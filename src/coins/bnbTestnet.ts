import type { CoinModule, CoinRuntimeContext, Network, NetworkCapabilitiesInput } from './types'
import { createEvmCoinModule } from './factories'
import { getUnifiedLogoByName } from './logos'

const bnbTestnetModule = createEvmCoinModule({
  id: 'bnb-testnet',
  runtimeModelId: 'bnb',
  name: 'BSC Testnet',
  symbol: 'tBNB',
  coinSymbol: 'tBNB',
  chainId: 97,
  bridgeCoinId: 'bsc-testnet',
  bridgeChain: 'test',
  logo: getUnifiedLogoByName('bnb'),
  rpcEnvKey: 'VITE_BSC_TESTNET_RPC',
  rpcUserEnvKey: 'VITE_BSC_TESTNET_RPC_USER',
  rpcPasswordEnvKey: 'VITE_BSC_TESTNET_RPC_PASSWORD',
  bridgeUserEnvKey: 'VITE_BSC_TESTNET_BRIDGE_USER',
  bridgePasswordEnvKey: 'VITE_BSC_TESTNET_BRIDGE_PASSWORD',
  explorerEnvKey: 'VITE_BSC_TESTNET_EXPLORER',
  defaultRpcUrl: 'https://bsc-testnet-rpc.publicnode.com',
  defaultExplorerUrl: 'https://testnet.bscscan.com'
})

export const BNB_TESTNET_CAPABILITIES: NetworkCapabilitiesInput = bnbTestnetModule.capabilities
export const createBnbTestnetNetwork: (ctx: CoinRuntimeContext) => Network = bnbTestnetModule.createNetwork
export const bnbTestnetCoin: CoinModule = bnbTestnetModule.coin
