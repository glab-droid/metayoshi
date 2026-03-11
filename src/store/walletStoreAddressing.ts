import type { CoinType, Network } from '../coins'
import { deriveAddressForNetwork, resolveNetworkProtocolFamily } from '../lib/protocolRegistry'

export async function deriveSingleNetworkAddress(
  mnemonic: string,
  network: Network,
  derivationIndex: number
): Promise<string> {
  return deriveAddressForNetwork(mnemonic, network, derivationIndex)
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
  let firstXrpAddress = ''
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
      if (net.coinType === 'XRP' && !firstXrpAddress) firstXrpAddress = address
      if (resolveNetworkProtocolFamily(net) === 'cosmos' && !firstCosmosAddress) {
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
      SUI: '',
      XRP: firstXrpAddress
    },
    networkAddresses,
    derivationErrors
  }
}
