import type { CoinModule, CoinRuntimeContext, Network, NetworkCapabilitiesInput } from './types'
import { createEvmCoinModule } from './factories'
import { getUnifiedLogoByName } from './logos'

const avaxcModule = createEvmCoinModule({
  id: 'avaxc',
  name: 'Avalanche',
  symbol: 'AVAX',
  coinSymbol: 'AVAX',
  chainId: 43114,
  bridgeCoinId: 'avalanche-c-chain',
  logo: getUnifiedLogoByName('avalanche'),
  rpcEnvKey: 'VITE_AVAXC_RPC',
  rpcUserEnvKey: 'VITE_AVAXC_RPC_USER',
  rpcPasswordEnvKey: 'VITE_AVAXC_RPC_PASSWORD',
  bridgeUserEnvKey: 'VITE_AVAXC_BRIDGE_USER',
  bridgePasswordEnvKey: 'VITE_AVAXC_BRIDGE_PASSWORD',
  explorerEnvKey: 'VITE_AVAXC_EXPLORER',
  defaultRpcUrl: 'https://avalanche-c-chain-rpc.publicnode.com',
  defaultExplorerUrl: 'https://snowtrace.io'
})

export const AVAXC_CAPABILITIES: NetworkCapabilitiesInput = avaxcModule.capabilities
export const createAvaxcNetwork: (ctx: CoinRuntimeContext) => Network = avaxcModule.createNetwork
export const avaxcCoin: CoinModule = avaxcModule.coin
