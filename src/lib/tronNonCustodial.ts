import { TronWeb } from 'tronweb'

function parseTrxToSun(amount: string): number {
  const raw = String(amount || '').trim()
  if (!/^\d+(\.\d+)?$/.test(raw)) throw new Error('Invalid TRX amount')
  const [whole, frac = ''] = raw.split('.')
  if (frac.length > 6) throw new Error('TRX supports up to 6 decimals')
  const sun = Number(`${whole}${frac.padEnd(6, '0')}`)
  if (!Number.isFinite(sun) || sun <= 0) throw new Error('Amount must be greater than 0')
  return Math.trunc(sun)
}

function buildTronWeb(rpcUrl: string): TronWeb {
  const apiKey = String(import.meta.env.VITE_TRON_API_KEY || '').trim()
  return new TronWeb({
    fullHost: rpcUrl,
    headers: apiKey ? { 'TRON-PRO-API-KEY': apiKey } : undefined
  } as any)
}

function parseDecimalToBigInt(amount: string, decimals: number, label: string): bigint {
  const raw = String(amount || '').trim()
  if (!/^\d+(\.\d+)?$/.test(raw)) throw new Error(`Invalid ${label} amount`)
  const [whole, frac = ''] = raw.split('.')
  if (frac.length > decimals) throw new Error(`${label} supports up to ${decimals} decimals`)
  const combined = `${whole}${frac.padEnd(decimals, '0')}`.replace(/^0+/, '') || '0'
  const out = BigInt(combined)
  if (out <= 0n) throw new Error('Amount must be greater than 0')
  return out
}

function normalizeTronContractAddress(tronWeb: TronWeb, contract: string): string {
  const raw = String(contract || '').trim()
  if (!raw) throw new Error('TRC20 contract address is required')
  // Accept base58 and hex forms.
  if (TronWeb.isAddress(raw)) return raw
  // Tron hex contracts typically start with "41" (hex) and are 42 bytes in hex string.
  if (/^41[a-fA-F0-9]{40}$/.test(raw)) return tronWeb.address.fromHex(raw)
  throw new Error('Invalid TRC20 contract address')
}

export async function readTrc20TokenMetadata(rpcUrl: string, contractAddress: string): Promise<{ symbol: string; decimals: number }> {
  const tronWeb = buildTronWeb(rpcUrl)
  const normalized = normalizeTronContractAddress(tronWeb, contractAddress)
  const contract = await tronWeb.contract().at(normalized)
  const [symbolRaw, decimalsRaw] = await Promise.all([
    (contract as any).symbol().call().catch(() => ''),
    (contract as any).decimals().call().catch(() => 6)
  ])
  const symbol = String(symbolRaw || '').trim().toUpperCase() || 'TRC20'
  const decimals = Math.max(0, Math.min(18, Number(decimalsRaw)))
  return { symbol, decimals: Number.isFinite(decimals) ? decimals : 6 }
}

export async function getTrc20BalanceRaw(rpcUrl: string, contractAddress: string, owner: string): Promise<bigint> {
  const tronWeb = buildTronWeb(rpcUrl)
  const normalized = normalizeTronContractAddress(tronWeb, contractAddress)
  const ownerAddress = String(owner || '').trim()
  if (!TronWeb.isAddress(ownerAddress)) throw new Error('Invalid TRON owner address')
  const contract = await tronWeb.contract().at(normalized)
  const raw = await (contract as any).balanceOf(ownerAddress).call()
  const asText = typeof raw === 'string' || typeof raw === 'number' ? String(raw) : String(raw?.toString?.() ?? '0')
  if (!/^\d+$/.test(asText)) return 0n
  return BigInt(asText)
}

export async function sendTrc20NonCustodial(params: {
  rpcUrl: string
  contractAddress: string
  fromAddress: string
  toAddress: string
  amountRaw: bigint
  privateKeyHex: string
}): Promise<{ hash: string }> {
  const rpcUrl = String(params.rpcUrl || '').trim()
  const fromAddress = String(params.fromAddress || '').trim()
  const toAddress = String(params.toAddress || '').trim()
  if (!TronWeb.isAddress(fromAddress)) throw new Error('Invalid TRON sender address')
  if (!TronWeb.isAddress(toAddress)) throw new Error('Invalid TRON destination address')
  if (params.amountRaw <= 0n) throw new Error('Amount must be greater than 0')

  const tronWeb = buildTronWeb(rpcUrl)
  const normalizedContract = normalizeTronContractAddress(tronWeb, params.contractAddress)

  const privateKey = String(params.privateKeyHex || '').trim()
  const derivedAddress = TronWeb.address.fromPrivateKey(privateKey)
  if (!derivedAddress || derivedAddress !== fromAddress) {
    throw new Error(`Derived TRON signer does not match active address (${derivedAddress || 'unknown'} != ${fromAddress})`)
  }

  const trigger = await tronWeb.transactionBuilder.triggerSmartContract(
    normalizedContract,
    'transfer(address,uint256)',
    // feeLimit is important for TRC20 transfers on shared gateways.
    { feeLimit: 20_000_000 },
    [
      { type: 'address', value: toAddress },
      { type: 'uint256', value: params.amountRaw.toString() }
    ],
    fromAddress
  )
  const tx = (trigger as any)?.transaction
  if (!tx) throw new Error('Failed to build TRC20 transfer transaction')
  const signed = await tronWeb.trx.sign(tx, privateKey)
  const submitted = await tronWeb.trx.sendRawTransaction(signed as any)
  const hash = String((submitted as any)?.txid || '').trim()
  if (!hash) throw new Error(`TRC20 submit failed: ${String((submitted as any)?.code || (submitted as any)?.message || 'missing txid')}`)
  return { hash }
}

export function parseTrc20UiAmountToRaw(amountUi: string, decimals: number): bigint {
  const d = Number(decimals)
  const safeDecimals = Number.isFinite(d) ? Math.max(0, Math.min(18, Math.trunc(d))) : 6
  return parseDecimalToBigInt(amountUi, safeDecimals, 'TRC20')
}

export async function getTronBalance(rpcUrl: string, address: string): Promise<string> {
  const tronWeb = buildTronWeb(rpcUrl)
  const sun = await tronWeb.trx.getBalance(String(address || '').trim())
  const trx = Number(sun) / 1e6
  return trx.toFixed(6).replace(/\.?0+$/, '')
}

export async function sendTronNonCustodial(params: {
  rpcUrl: string
  fromAddress: string
  toAddress: string
  amountTrx: string
  privateKeyHex: string
}): Promise<{ hash: string }> {
  const fromAddress = String(params.fromAddress || '').trim()
  const toAddress = String(params.toAddress || '').trim()
  if (!TronWeb.isAddress(fromAddress)) throw new Error('Invalid TRON sender address')
  if (!TronWeb.isAddress(toAddress)) throw new Error('Invalid TRON destination address')
  const privateKey = String(params.privateKeyHex || '').trim()
  const derivedAddress = TronWeb.address.fromPrivateKey(privateKey)
  if (!derivedAddress || derivedAddress !== fromAddress) {
    throw new Error(`Derived TRON signer does not match active address (${derivedAddress || 'unknown'} != ${fromAddress})`)
  }

  const tronWeb = buildTronWeb(params.rpcUrl)
  const amountSun = parseTrxToSun(params.amountTrx)
  const unsignedTx = await tronWeb.transactionBuilder.sendTrx(toAddress, amountSun, fromAddress)
  const signedTx = await tronWeb.trx.sign(unsignedTx as any, privateKey)
  const submitted = await tronWeb.trx.sendRawTransaction(signedTx as any)
  const hash = String((submitted as any)?.txid || '').trim()
  if (!hash) throw new Error(`TRON submit failed: ${String((submitted as any)?.code || (submitted as any)?.message || 'missing txid')}`)
  return { hash }
}
