import * as secp from '@noble/secp256k1'
import { sha256 } from '@noble/hashes/sha256'

interface CosmosAccountInfo {
  accountNumber: bigint
  sequence: bigint
}

const DEFAULT_TIMEOUT_MS = 15000
const DEFAULT_GAS_LIMIT = 180000n
const DEFAULT_FEE_AMOUNT = 2500n
const DEFAULT_FEE_DENOM = String((import.meta as any)?.env?.VITE_COSMOS_FEE_DENOM || 'uatom').trim() || 'uatom'

function utf8(input: string): Uint8Array {
  return new TextEncoder().encode(String(input || ''))
}

function concatBytes(...chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, c) => sum + c.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.length
  }
  return out
}

function toBase64(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i += 1) out += String.fromCharCode(bytes[i])
  return btoa(out)
}

function encodeVarint(value: bigint): Uint8Array {
  if (value < 0n) throw new Error('Varint value must be unsigned')
  const out: number[] = []
  let n = value
  while (n >= 0x80n) {
    out.push(Number((n & 0x7fn) | 0x80n))
    n >>= 7n
  }
  out.push(Number(n))
  return new Uint8Array(out)
}

function fieldKey(fieldNo: number, wireType: 0 | 2): Uint8Array {
  return encodeVarint(BigInt((fieldNo << 3) | wireType))
}

function encodeFieldVarint(fieldNo: number, value: bigint): Uint8Array {
  return concatBytes(fieldKey(fieldNo, 0), encodeVarint(value))
}

function encodeFieldBytes(fieldNo: number, bytes: Uint8Array): Uint8Array {
  return concatBytes(fieldKey(fieldNo, 2), encodeVarint(BigInt(bytes.length)), bytes)
}

function encodeFieldString(fieldNo: number, value: string): Uint8Array {
  return encodeFieldBytes(fieldNo, utf8(value))
}

function parseUint(value: unknown, label: string): bigint {
  const raw = String(value ?? '').trim()
  if (!/^\d+$/.test(raw)) throw new Error(`Invalid ${label}`)
  return BigInt(raw)
}

function normalizeAmountRaw(value: string | number): bigint {
  const raw = String(value ?? '').trim()
  if (!/^\d+$/.test(raw)) {
    throw new Error('Cosmos transfer amount must be a positive integer in raw denom units')
  }
  const n = BigInt(raw)
  if (n <= 0n) throw new Error('Cosmos transfer amount must be greater than 0')
  return n
}

function extractCosmosBaseAccount(account: any): { account_number?: unknown; sequence?: unknown } {
  if (!account || typeof account !== 'object') return {}
  if (account.base_account && typeof account.base_account === 'object') return account.base_account
  if (account.base_vesting_account?.base_account && typeof account.base_vesting_account.base_account === 'object') {
    return account.base_vesting_account.base_account
  }
  return account
}

function deriveCosmosRestCandidates(rpcUrl: string): string[] {
  const raw = String(rpcUrl || '').trim().replace(/\/+$/, '')
  if (!raw) return []
  const out = new Set<string>([raw])
  try {
    const u = new URL(raw)
    const host = String(u.host || '').toLowerCase()
    out.add(`${u.protocol}//${host.replace('-rpc.publicnode.com', '-rest.publicnode.com')}`)
    out.add(`${u.protocol}//${host.replace('-rpc.publicnode.com', '-api.publicnode.com')}`)
  } catch {
    // keep raw URL only
  }
  return [...out].filter(Boolean)
}

async function fetchJsonWithFallback(
  urls: string[],
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<any> {
  let lastError: unknown = null
  for (const url of urls) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: controller.signal
      })
      if (!res.ok) {
        lastError = new Error(`HTTP ${res.status}`)
        continue
      }
      return await res.json()
    } catch (err) {
      lastError = err
    } finally {
      clearTimeout(timer)
    }
  }
  if (lastError instanceof Error) throw lastError
  throw new Error('No reachable Cosmos REST endpoint')
}

async function queryCosmosAccountAndChainId(rpcUrl: string, fromAddress: string): Promise<{
  account: CosmosAccountInfo
  chainId: string
}> {
  const bases = deriveCosmosRestCandidates(rpcUrl)
  if (bases.length === 0) throw new Error('Cosmos RPC URL is not configured')

  const accountUrls = bases.map((base) => `${base}/cosmos/auth/v1beta1/accounts/${encodeURIComponent(fromAddress)}`)
  const nodeInfoUrls = bases.map((base) => `${base}/cosmos/base/tendermint/v1beta1/node_info`)
  const statusUrls = bases.map((base) => `${base}/status`)

  const accountJson = await fetchJsonWithFallback(accountUrls)
  const accountNode = extractCosmosBaseAccount(accountJson?.account || {})
  const accountNumber = parseUint(accountNode?.account_number, 'account_number')
  const sequence = parseUint(accountNode?.sequence, 'sequence')

  let chainId = ''
  try {
    const nodeInfoJson = await fetchJsonWithFallback(nodeInfoUrls)
    chainId = String(nodeInfoJson?.default_node_info?.network || nodeInfoJson?.node_info?.network || '').trim()
  } catch {
    chainId = ''
  }
  if (!chainId) {
    const statusJson = await fetchJsonWithFallback(statusUrls)
    chainId = String(statusJson?.result?.node_info?.network || '').trim()
  }
  if (!chainId) throw new Error('Unable to resolve Cosmos chain id from REST endpoints')

  return {
    account: { accountNumber, sequence },
    chainId
  }
}

function encodeCosmosCoin(denom: string, amountRaw: bigint): Uint8Array {
  return concatBytes(
    encodeFieldString(1, denom),
    encodeFieldString(2, amountRaw.toString())
  )
}

function encodeCosmosMsgSend(input: {
  fromAddress: string
  toAddress: string
  denom: string
  amountRaw: bigint
}): Uint8Array {
  const amountCoin = encodeCosmosCoin(input.denom, input.amountRaw)
  return concatBytes(
    encodeFieldString(1, input.fromAddress),
    encodeFieldString(2, input.toAddress),
    encodeFieldBytes(3, amountCoin)
  )
}

function encodeCosmosMsgExecuteContract(input: {
  sender: string
  contract: string
  msg: Uint8Array
  funds?: Array<{ denom: string; amountRaw: bigint }>
}): Uint8Array {
  const chunks: Uint8Array[] = [
    encodeFieldString(1, input.sender),
    encodeFieldString(2, input.contract),
    encodeFieldBytes(3, input.msg)
  ]
  for (const fund of input.funds || []) {
    chunks.push(encodeFieldBytes(5, encodeCosmosCoin(fund.denom, fund.amountRaw)))
  }
  return concatBytes(...chunks)
}

function encodeAny(typeUrl: string, value: Uint8Array): Uint8Array {
  return concatBytes(
    encodeFieldString(1, typeUrl),
    encodeFieldBytes(2, value)
  )
}

function encodePubKeyAny(compressedPubKey: Uint8Array): Uint8Array {
  const pubKey = encodeFieldBytes(1, compressedPubKey)
  return encodeAny('/cosmos.crypto.secp256k1.PubKey', pubKey)
}

function encodeTxBody(input: {
  msgAny: Uint8Array
  memo?: string
}): Uint8Array {
  const chunks: Uint8Array[] = [encodeFieldBytes(1, input.msgAny)]
  const memo = String(input.memo || '').trim()
  if (memo) chunks.push(encodeFieldString(2, memo))
  return concatBytes(...chunks)
}

function encodeModeInfoSingleDirect(): Uint8Array {
  const modeSingle = encodeFieldVarint(1, 1n) // SIGN_MODE_DIRECT
  return encodeFieldBytes(1, modeSingle)
}

function encodeSignerInfo(input: {
  pubKeyAny: Uint8Array
  sequence: bigint
}): Uint8Array {
  return concatBytes(
    encodeFieldBytes(1, input.pubKeyAny),
    encodeFieldBytes(2, encodeModeInfoSingleDirect()),
    encodeFieldVarint(3, input.sequence)
  )
}

function encodeFee(input: {
  feeDenom: string
  feeAmount: bigint
  gasLimit: bigint
}): Uint8Array {
  const amount = encodeCosmosCoin(input.feeDenom, input.feeAmount)
  return concatBytes(
    encodeFieldBytes(1, amount),
    encodeFieldVarint(2, input.gasLimit)
  )
}

function encodeAuthInfo(input: {
  signerInfo: Uint8Array
  fee: Uint8Array
}): Uint8Array {
  return concatBytes(
    encodeFieldBytes(1, input.signerInfo),
    encodeFieldBytes(2, input.fee)
  )
}

function encodeSignDoc(input: {
  bodyBytes: Uint8Array
  authInfoBytes: Uint8Array
  chainId: string
  accountNumber: bigint
}): Uint8Array {
  return concatBytes(
    encodeFieldBytes(1, input.bodyBytes),
    encodeFieldBytes(2, input.authInfoBytes),
    encodeFieldString(3, input.chainId),
    encodeFieldVarint(4, input.accountNumber)
  )
}

function encodeTxRaw(input: {
  bodyBytes: Uint8Array
  authInfoBytes: Uint8Array
  signature: Uint8Array
}): Uint8Array {
  return concatBytes(
    encodeFieldBytes(1, input.bodyBytes),
    encodeFieldBytes(2, input.authInfoBytes),
    encodeFieldBytes(3, input.signature)
  )
}

async function signCosmosAnyMessageTxBase64(input: {
  rpcUrl: string
  fromAddress: string
  privateKeyHex: string
  msgTypeUrl: string
  msgBytes: Uint8Array
  feeDenom?: string
  feeAmountRaw?: string | number
  gasLimit?: string | number
  memo?: string
}): Promise<string> {
  const fromAddress = String(input.fromAddress || '').trim()
  const privateKeyHex = String(input.privateKeyHex || '').trim()
  const msgTypeUrl = String(input.msgTypeUrl || '').trim()
  const memo = String(input.memo || '').trim()
  if (!fromAddress) throw new Error('Cosmos sender address is required')
  if (!msgTypeUrl) throw new Error('Cosmos message type is required')
  if (!input.msgBytes || input.msgBytes.length === 0) throw new Error('Cosmos message payload is required')
  if (!/^[0-9a-f]{64}$/i.test(privateKeyHex)) throw new Error('Cosmos private key must be 32-byte hex')

  const feeDenom = String(input.feeDenom || DEFAULT_FEE_DENOM).trim() || DEFAULT_FEE_DENOM
  const feeAmount = input.feeAmountRaw === undefined
    ? DEFAULT_FEE_AMOUNT
    : normalizeAmountRaw(input.feeAmountRaw)
  const gasLimit = input.gasLimit === undefined
    ? DEFAULT_GAS_LIMIT
    : normalizeAmountRaw(input.gasLimit)

  const { account, chainId } = await queryCosmosAccountAndChainId(input.rpcUrl, fromAddress)
  const privKey = secp.etc.hexToBytes(privateKeyHex)
  const compressedPubKey = secp.getPublicKey(privKey, true)

  const msgAny = encodeAny(msgTypeUrl, input.msgBytes)
  const txBodyBytes = encodeTxBody({ msgAny, memo })
  const signerInfo = encodeSignerInfo({
    pubKeyAny: encodePubKeyAny(compressedPubKey),
    sequence: account.sequence
  })
  const authInfoBytes = encodeAuthInfo({
    signerInfo,
    fee: encodeFee({
      feeDenom,
      feeAmount,
      gasLimit
    })
  })
  const signDocBytes = encodeSignDoc({
    bodyBytes: txBodyBytes,
    authInfoBytes,
    chainId,
    accountNumber: account.accountNumber
  })
  const signDigest = sha256(signDocBytes)
  const signature = secp.sign(signDigest, privKey, {
    prehash: false,
    lowS: true,
    format: 'compact'
  })
  const txRawBytes = encodeTxRaw({
    bodyBytes: txBodyBytes,
    authInfoBytes,
    signature
  })
  return toBase64(txRawBytes)
}

export async function signCosmosTokenTransferTxBase64(input: {
  rpcUrl: string
  fromAddress: string
  toAddress: string
  denom: string
  amountRaw: string | number
  privateKeyHex: string
  feeDenom?: string
  feeAmountRaw?: string | number
  gasLimit?: string | number
  memo?: string
}): Promise<string> {
  const fromAddress = String(input.fromAddress || '').trim()
  const toAddress = String(input.toAddress || '').trim()
  const denom = String(input.denom || '').trim()
  const privateKeyHex = String(input.privateKeyHex || '').trim()
  const memo = String(input.memo || '').trim()
  if (!fromAddress) throw new Error('Cosmos sender address is required')
  if (!toAddress) throw new Error('Cosmos destination address is required')
  if (!denom) throw new Error('Cosmos token denom is required')
  if (!/^[0-9a-f]{64}$/i.test(privateKeyHex)) throw new Error('Cosmos private key must be 32-byte hex')

  const amountRaw = normalizeAmountRaw(input.amountRaw)
  const msgSend = encodeCosmosMsgSend({
    fromAddress,
    toAddress,
    denom,
    amountRaw
  })
  return await signCosmosAnyMessageTxBase64({
    rpcUrl: input.rpcUrl,
    fromAddress,
    privateKeyHex,
    msgTypeUrl: '/cosmos.bank.v1beta1.MsgSend',
    msgBytes: msgSend,
    feeDenom: input.feeDenom,
    feeAmountRaw: input.feeAmountRaw,
    gasLimit: input.gasLimit,
    memo
  })
}

export async function signCosmosExecuteContractTxBase64(input: {
  rpcUrl: string
  fromAddress: string
  contractAddress: string
  executeMsg: Record<string, unknown>
  privateKeyHex: string
  funds?: Array<{ denom: string; amountRaw: string | number }>
  feeDenom?: string
  feeAmountRaw?: string | number
  gasLimit?: string | number
  memo?: string
}): Promise<string> {
  const sender = String(input.fromAddress || '').trim()
  const contract = String(input.contractAddress || '').trim()
  const privateKeyHex = String(input.privateKeyHex || '').trim()
  const memo = String(input.memo || '').trim()
  if (!sender) throw new Error('Cosmos sender address is required')
  if (!contract) throw new Error('Cosmos contract address is required')
  if (!/^[0-9a-f]{64}$/i.test(privateKeyHex)) throw new Error('Cosmos private key must be 32-byte hex')
  if (!input.executeMsg || typeof input.executeMsg !== 'object' || Array.isArray(input.executeMsg)) {
    throw new Error('Cosmos executeMsg must be an object')
  }
  const executeMsgBytes = utf8(JSON.stringify(input.executeMsg))
  const funds = (input.funds || []).map((row) => ({
    denom: String(row.denom || '').trim(),
    amountRaw: normalizeAmountRaw(row.amountRaw)
  })).filter((row) => row.denom && row.amountRaw > 0n)
  const msg = encodeCosmosMsgExecuteContract({
    sender,
    contract,
    msg: executeMsgBytes,
    funds
  })
  return await signCosmosAnyMessageTxBase64({
    rpcUrl: input.rpcUrl,
    fromAddress: sender,
    privateKeyHex,
    msgTypeUrl: '/cosmwasm.wasm.v1.MsgExecuteContract',
    msgBytes: msg,
    feeDenom: input.feeDenom,
    feeAmountRaw: input.feeAmountRaw,
    gasLimit: input.gasLimit ?? 260000,
    memo
  })
}
