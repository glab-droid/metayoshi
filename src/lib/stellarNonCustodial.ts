import { Asset, Horizon, Keypair, Networks, Operation, StrKey, TransactionBuilder } from '@stellar/stellar-sdk'
import { hexToBytes } from '@noble/hashes/utils'
import { Buffer } from 'buffer'

function resolveStellarNetworkPassphrase(rpcUrl?: string): string {
  const env = String(import.meta.env.VITE_XLM_NETWORK || '').trim().toLowerCase()
  if (env === 'testnet') return Networks.TESTNET
  if (env === 'public' || env === 'mainnet') return Networks.PUBLIC
  return /testnet/i.test(String(rpcUrl || '')) ? Networks.TESTNET : Networks.PUBLIC
}

export async function getStellarBalance(rpcUrl: string, address: string): Promise<string> {
  const server = new Horizon.Server(rpcUrl)
  try {
    const account = await server.loadAccount(String(address || '').trim())
    const native = account.balances.find((b: any) => b.asset_type === 'native')
    const amount = String((native as any)?.balance ?? '0').trim()
    return amount || '0'
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (/not found|resource missing/i.test(message)) return '0'
    throw error
  }
}

export async function sendStellarNonCustodial(params: {
  rpcUrl: string
  fromAddress: string
  toAddress: string
  amountXlm: string
  privateKeyHex: string
}): Promise<{ hash: string }> {
  const fromAddress = String(params.fromAddress || '').trim()
  const toAddress = String(params.toAddress || '').trim()
  const amountXlm = String(params.amountXlm || '').trim()
  if (!StrKey.isValidEd25519PublicKey(fromAddress)) throw new Error('Invalid Stellar sender address')
  if (!StrKey.isValidEd25519PublicKey(toAddress)) throw new Error('Invalid Stellar destination address')
  if (!/^\d+(\.\d+)?$/.test(amountXlm)) throw new Error('Invalid XLM amount')

  const pair = Keypair.fromRawEd25519Seed(Buffer.from(hexToBytes(String(params.privateKeyHex || '').trim())))
  if (pair.publicKey() !== fromAddress) {
    throw new Error(`Derived XLM signer does not match active address (${pair.publicKey()} != ${fromAddress})`)
  }

  const server = new Horizon.Server(params.rpcUrl)
  const sourceAccount = await server.loadAccount(fromAddress)
  const baseFee = await server.fetchBaseFee()
  const tx = new TransactionBuilder(sourceAccount, {
    fee: String(baseFee),
    networkPassphrase: resolveStellarNetworkPassphrase(params.rpcUrl)
  })
    .addOperation(
      Operation.payment({
        destination: toAddress,
        asset: Asset.native(),
        amount: amountXlm
      })
    )
    .setTimeout(180)
    .build()

  tx.sign(pair)
  const submitted = await server.submitTransaction(tx)
  const hash = String((submitted as any)?.hash || '').trim()
  if (!hash) throw new Error('Stellar submit succeeded but tx hash is missing')
  return { hash }
}
