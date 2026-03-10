import { ethers } from 'ethers'
import type { CoinType, Network } from '../coins'
import { deriveCosmosAddress } from '../lib/cosmosAddress'
import { deriveSuiAddress } from '../lib/suiAddress'
import { resolveRuntimeModelId as resolveNetworkModelId } from '../lib/runtimeModel'
import { deriveUtxoAddress } from '../lib/utxoAddress'
import { isCroCosmosModel, resolveCosmosNetworkConfig } from './walletStoreStateUtils'

let cardanoAddressModulePromise: Promise<typeof import('../lib/cardanoAddress')> | null = null
let solanaAddressModulePromise: Promise<typeof import('../lib/solanaAddress')> | null = null
let stellarAddressModulePromise: Promise<typeof import('../lib/stellarAddress')> | null = null
let tronAddressModulePromise: Promise<typeof import('../lib/tronAddress')> | null = null

function loadCardanoAddressModule() {
  if (!cardanoAddressModulePromise) cardanoAddressModulePromise = import('../lib/cardanoAddress')
  return cardanoAddressModulePromise
}

function loadSolanaAddressModule() {
  if (!solanaAddressModulePromise) solanaAddressModulePromise = import('../lib/solanaAddress')
  return solanaAddressModulePromise
}

function loadStellarAddressModule() {
  if (!stellarAddressModulePromise) stellarAddressModulePromise = import('../lib/stellarAddress')
  return stellarAddressModulePromise
}

function loadTronAddressModule() {
  if (!tronAddressModulePromise) tronAddressModulePromise = import('../lib/tronAddress')
  return tronAddressModulePromise
}

function evmDerivationPath(accountIndex: number): string {
  return `m/44'/60'/${accountIndex}'/0/0`
}

function deriveEvmAddress(mnemonic: string, derivationIndex: number): string {
  return ethers.HDNodeWallet.fromPhrase(mnemonic, undefined, evmDerivationPath(derivationIndex)).address
}

export async function deriveSingleNetworkAddress(
  mnemonic: string,
  network: Network,
  derivationIndex: number
): Promise<string> {
  const modelId = resolveNetworkModelId(network)

  // Address derivation stays per-runtime so adding or removing chains does not
  // leak assumptions into unrelated families.
  if (network.coinType === 'EVM') {
    return deriveEvmAddress(mnemonic, derivationIndex)
  }
  if (modelId === 'cosmos' || isCroCosmosModel(network)) {
    const cosmosCfg = resolveCosmosNetworkConfig(network)
    const derived = await deriveCosmosAddress(mnemonic, derivationIndex, cosmosCfg)
    return derived.address
  }
  if (network.coinType === 'UTXO' && network.coinSymbol) {
    const derived = await deriveUtxoAddress(mnemonic, network.coinSymbol, derivationIndex, 0, 0)
    return derived.address
  }
  if (modelId === 'ada') {
    const { deriveCardanoAddress } = await loadCardanoAddressModule()
    const derived = await deriveCardanoAddress(mnemonic, derivationIndex, network.rpcUrl)
    return derived.address
  }
  if (modelId === 'sol') {
    const { deriveSolanaAddress } = await loadSolanaAddressModule()
    const derived = await deriveSolanaAddress(mnemonic, derivationIndex)
    return derived.address
  }
  if (modelId === 'sui') {
    const derived = await deriveSuiAddress(mnemonic, derivationIndex)
    return derived.address
  }
  if (modelId === 'xlm') {
    const { deriveStellarAddress } = await loadStellarAddressModule()
    const derived = await deriveStellarAddress(mnemonic, derivationIndex)
    return derived.address
  }
  if (modelId === 'tron') {
    const { deriveTronAddress } = await loadTronAddressModule()
    const derived = await deriveTronAddress(mnemonic, derivationIndex)
    return derived.address
  }

  return ''
}

export async function deriveAccountAddresses(
  mnemonic: string,
  networks: Network[],
  derivationIndex: number
): Promise<{
  addresses: Record<CoinType, string>
  networkAddresses: Record<string, string>
  derivationErrors: string[]
}> {
  const networkAddresses: Record<string, string> = {}
  const derivationErrors: string[] = []
  let firstUtxoAddress = ''
  let firstCosmosAddress = ''
  let evmAddress = ''

  for (const net of networks) {
    if (net.derivation?.status === 'unsupported') {
      const reason = net.derivation.reason || `${net.name} derivation is not supported in this build`
      derivationErrors.push(`${net.symbol}: ${reason}`)
      continue
    }

    try {
      const address = await deriveSingleNetworkAddress(mnemonic, net, derivationIndex)
      if (!address) continue
      networkAddresses[net.id] = address
      if (net.coinType === 'EVM' && !evmAddress) evmAddress = address
      if (net.coinType === 'UTXO' && !firstUtxoAddress) firstUtxoAddress = address
      if ((resolveNetworkModelId(net) === 'cosmos' || isCroCosmosModel(net)) && !firstCosmosAddress) {
        firstCosmosAddress = address
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      derivationErrors.push(`${net.symbol}: ${msg}`)
      console.warn(`Failed to derive ${net.symbol} address (account ${derivationIndex}):`, err)
    }
  }

  return {
    addresses: {
      EVM: evmAddress,
      UTXO: firstUtxoAddress,
      BTC: '',
      COSMOS: firstCosmosAddress,
      SOL: '',
      SUI: ''
    },
    networkAddresses,
    derivationErrors
  }
}
