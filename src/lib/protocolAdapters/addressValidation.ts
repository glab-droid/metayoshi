import type { Network } from '../../coins'
import { isSuiAddress } from '../suiAddress'
import { isCosmosLikeModelId } from '../runtimeModel'
import { isValidCosmosAddress } from './cosmos'

let ethersModulePromise: Promise<typeof import('ethers')> | null = null
let solanaWeb3ModulePromise: Promise<typeof import('@solana/web3.js')> | null = null
let stellarSdkModulePromise: Promise<typeof import('@stellar/stellar-sdk')> | null = null
let tronWebModulePromise: Promise<typeof import('tronweb')> | null = null

function loadEthersModule() {
  if (!ethersModulePromise) ethersModulePromise = import('ethers')
  return ethersModulePromise
}

function loadSolanaWeb3Module() {
  if (!solanaWeb3ModulePromise) solanaWeb3ModulePromise = import('@solana/web3.js')
  return solanaWeb3ModulePromise
}

function loadStellarSdkModule() {
  if (!stellarSdkModulePromise) stellarSdkModulePromise = import('@stellar/stellar-sdk')
  return stellarSdkModulePromise
}

function loadTronWebModule() {
  if (!tronWebModulePromise) tronWebModulePromise = import('tronweb')
  return tronWebModulePromise
}

export async function validateProtocolAddress(
  network: Network,
  modelId: string,
  protocol: string,
  value: string
): Promise<boolean | null> {
  if (modelId === 'sol') {
    try {
      const { PublicKey } = await loadSolanaWeb3Module()
      void new PublicKey(value)
      return true
    } catch {
      return false
    }
  }
  if (modelId === 'xlm') {
    const { StrKey } = await loadStellarSdkModule()
    return StrKey.isValidEd25519PublicKey(value)
  }
  if (modelId === 'tron') {
    const tronweb = await loadTronWebModule()
    return tronweb.TronWeb.isAddress(value)
  }
  if (modelId === 'sui') {
    return isSuiAddress(value)
  }
  if (isCosmosLikeModelId(modelId)) {
    return isValidCosmosAddress(network, value)
  }
  if (network.coinType === 'EVM') {
    const { ethers } = await loadEthersModule()
    return ethers.isAddress(value)
  }
  return null
}
