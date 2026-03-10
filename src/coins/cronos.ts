import type { CoinModule, CoinRuntimeContext, Network, NetworkCapabilitiesInput } from './types'
import { createEvmCoinModule } from './factories'
import { getUnifiedLogoByName } from './logos'

const cronosModule = createEvmCoinModule({
  id: 'cronos',
  name: 'Cronos',
  symbol: 'CRO',
  coinSymbol: 'CRO',
  chainId: 25,
  bridgeCoinId: 'cronos',
  logo: getUnifiedLogoByName('cronos'),
  rpcEnvKey: 'VITE_CRONOS_RPC',
  rpcUserEnvKey: 'VITE_CRONOS_RPC_USER',
  rpcPasswordEnvKey: 'VITE_CRONOS_RPC_PASSWORD',
  bridgeUserEnvKey: 'VITE_CRONOS_BRIDGE_USER',
  bridgePasswordEnvKey: 'VITE_CRONOS_BRIDGE_PASSWORD',
  explorerEnvKey: 'VITE_CRONOS_EXPLORER',
  defaultRpcUrl: 'https://cronos-rpc.publicnode.com',
  defaultExplorerUrl: 'https://cronoscan.com'
})

export const CRONOS_CAPABILITIES: NetworkCapabilitiesInput = cronosModule.capabilities
export const createCronosNetwork: (ctx: CoinRuntimeContext) => Network = cronosModule.createNetwork
export const cronosCoin: CoinModule = cronosModule.coin
