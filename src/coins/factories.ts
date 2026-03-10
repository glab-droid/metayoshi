import { readBridgeCredentialsFromEnv } from '../lib/bridgeCredentials'
import type { CoinModule, CoinRuntimeContext, Network, NetworkCapabilitiesInput } from './types'

export const FULL_ASSET_CAPABILITIES: NetworkCapabilitiesInput = {
  features: { nativeSend: true, assetLayer: true, assetSend: true, activity: true },
  ui: { showAssetsTab: true, showAssetsAction: true, showSendAction: true, showActivityTab: true }
}

export const NATIVE_ONLY_CAPABILITIES: NetworkCapabilitiesInput = {
  features: { nativeSend: true, assetLayer: false, assetSend: false, activity: true },
  ui: { showAssetsTab: false, showAssetsAction: false, showSendAction: true, showActivityTab: true }
}

type BridgeCredentialConfig = {
  userEnvKey?: string
  passEnvKey?: string
  label?: string
}

export function resolveBridgeCredentials(config?: BridgeCredentialConfig): {
  bridgeUsername?: string
  bridgePassword?: string
} {
  const env = (import.meta as any)?.env || {}
  return readBridgeCredentialsFromEnv(env, {
    userEnvKey: config?.userEnvKey,
    passEnvKey: config?.passEnvKey,
    label: config?.label
  })
}

type EvmCoinFactoryConfig = {
  id: string
  runtimeModelId?: string
  name: string
  symbol: string
  coinSymbol: string
  chainId: number
  bridgeCoinId: string
  bridgeChain?: 'main' | 'test'
  logo: string
  rpcEnvKey: string
  rpcUserEnvKey: string
  rpcPasswordEnvKey: string
  bridgeUserEnvKey: string
  bridgePasswordEnvKey: string
  explorerEnvKey: string
  defaultRpcUrl: string
  defaultExplorerUrl: string
  capabilities?: NetworkCapabilitiesInput
}

export function createEvmCoinModule(config: EvmCoinFactoryConfig): {
  createNetwork: (ctx: CoinRuntimeContext) => Network
  coin: CoinModule
  capabilities: NetworkCapabilitiesInput
} {
  const capabilities = config.capabilities || FULL_ASSET_CAPABILITIES
  const env = (import.meta as any)?.env || {}

  const createNetwork = (ctx: CoinRuntimeContext): Network => ({
    id: config.id,
    runtimeModelId: String(config.runtimeModelId || config.id).trim().toLowerCase(),
    serverCoinId: config.bridgeCoinId,
    serverChain: config.bridgeChain || 'main',
    name: config.name,
    symbol: config.symbol,
    coinType: 'EVM',
    coinSymbol: config.coinSymbol,
    chainId: config.chainId,
    rpcUrl: String(env[config.rpcEnvKey] || config.defaultRpcUrl).trim() || config.defaultRpcUrl,
    rpcWallet: '',
    rpcUsername: String(env[config.rpcUserEnvKey] || '').trim(),
    rpcPassword: String(env[config.rpcPasswordEnvKey] || '').trim(),
    bridgeUrl: ctx.buildBridgeUrl(config.bridgeCoinId, config.bridgeChain || 'main'),
    ...readBridgeCredentialsFromEnv(env, {
      userEnvKey: config.bridgeUserEnvKey,
      passEnvKey: config.bridgePasswordEnvKey,
      label: config.id
    }),
    explorerUrl: String(env[config.explorerEnvKey] || config.defaultExplorerUrl).trim() || config.defaultExplorerUrl,
    capabilities,
    logo: config.logo
  })

  const coin: CoinModule = {
    id: config.id,
    symbol: config.symbol,
    coinSymbol: config.coinSymbol,
    capabilities,
    createNetwork
  }

  return { createNetwork, coin, capabilities }
}
