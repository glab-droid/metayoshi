import type {
  CoinModule,
  CoinRuntimeContext,
  Network,
  NetworkCapabilitiesInput,
  UtxoAddressSpec
} from './types'
import { NATIVE_ONLY_CAPABILITIES, resolveBridgeCredentials } from './factories'
import { getUnifiedLogoByName } from './logos'

export const DOGE_CAPABILITIES: NetworkCapabilitiesInput = NATIVE_ONLY_CAPABILITIES
export const DOGE_ADDRESS_SPEC: UtxoAddressSpec = {
  bip44CoinType: 3,
  p2pkhVersion: 0x1e
}

// Conservative DOGE baseline so send previews and spendability checks stay stable.
export const DOGE_FEE_PER_BYTE = 0.00001

export function estimateDogeFee(txBytes: number): number {
  return txBytes * DOGE_FEE_PER_BYTE
}

export function createDogeNetwork(ctx: CoinRuntimeContext): Network {
  const env = (import.meta as any)?.env || {}
  const { bridgeUsername, bridgePassword } = resolveBridgeCredentials({
    userEnvKey: 'VITE_DOGE_BRIDGE_USER',
    passEnvKey: 'VITE_DOGE_BRIDGE_PASSWORD'
  })

  return {
    id: 'doge',
    runtimeModelId: 'doge',
    serverCoinId: 'dogecoin',
    serverChain: 'main',
    name: 'Dogecoin',
    symbol: 'DOGE',
    coinType: 'UTXO',
    coinSymbol: 'DOGE',
    rpcUrl: ctx.apiBaseUrl,
    rpcWallet: '',
    rpcUsername: String(env.VITE_DOGE_RPC_USER || '').trim(),
    rpcPassword: String(env.VITE_DOGE_RPC_PASSWORD || '').trim(),
    bridgeUrl: ctx.buildBridgeUrl('dogecoin', 'main'),
    bridgeUsername,
    bridgePassword,
    explorerUrl: String(import.meta.env.VITE_DOGE_EXPLORER || 'https://dogechain.info').trim(),
    capabilities: DOGE_CAPABILITIES,
    feePerByte: DOGE_FEE_PER_BYTE,
    logo: getUnifiedLogoByName('dogecoin')
  }
}

export const dogeCoin: CoinModule = {
  id: 'doge',
  symbol: 'DOGE',
  coinSymbol: 'DOGE',
  capabilities: DOGE_CAPABILITIES,
  utxoAddress: DOGE_ADDRESS_SPEC,
  createNetwork: createDogeNetwork,
  estimateFee: estimateDogeFee
}
