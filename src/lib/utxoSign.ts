// Client-side UTXO transaction signing (more secure than RPC signing)
import { hexToBytes, bytesToHex } from '@noble/hashes/utils'
import { sha256 } from '@noble/hashes/sha256'
import { hmac } from '@noble/hashes/hmac'
import { blake2b } from '@noble/hashes/blake2b'
import * as secp from '@noble/secp256k1'

// noble v3 requires hash helpers to be wired by host app.
if (!secp.hashes.sha256) {
  secp.hashes.sha256 = (msg: Uint8Array) => sha256(msg)
}
if (!secp.hashes.hmacSha256) {
  secp.hashes.hmacSha256 = (key: Uint8Array, msg: Uint8Array) => hmac(sha256, key, msg)
}

interface TxInput {
  txid: string
  vout: number
  scriptSig: Uint8Array
  sequence: number
}

interface TxOutput {
  scriptPubKey: Uint8Array
  amountSats: number
}

interface TxData {
  version: number
  inputs: TxInput[]
  outputs: TxOutput[]
  locktime: number
}

const SIGHASH_ALL = 0x01

function concatBytes(...arrs: Uint8Array[]): Uint8Array {
  const len = arrs.reduce((n, a) => n + a.length, 0)
  const out = new Uint8Array(len)
  let o = 0
  for (const a of arrs) {
    out.set(a, o)
    o += a.length
  }
  return out
}

function u32LE(n: number): Uint8Array {
  const out = new Uint8Array(4)
  const dv = new DataView(out.buffer)
  dv.setUint32(0, n >>> 0, true)
  return out
}

function u64LE(n: number): Uint8Array {
  if (!Number.isSafeInteger(n) || n < 0) throw new Error('Invalid u64 amount')
  const out = new Uint8Array(8)
  let x = BigInt(n)
  for (let i = 0; i < 8; i++) {
    out[i] = Number(x & 0xffn)
    x >>= 8n
  }
  return out
}

function i64LE(n: bigint): Uint8Array {
  const min = -(1n << 63n)
  const max = (1n << 63n) - 1n
  if (n < min || n > max) throw new Error('Invalid i64 amount')
  let x = n < 0n ? (1n << 64n) + n : n
  const out = new Uint8Array(8)
  for (let i = 0; i < 8; i++) {
    out[i] = Number(x & 0xffn)
    x >>= 8n
  }
  return out
}

function readI64LE(raw: Uint8Array, offset: number): bigint {
  if (offset < 0 || offset + 8 > raw.length) throw new Error('Unexpected EOF while reading i64')
  let x = 0n
  for (let i = 7; i >= 0; i--) {
    x = (x << 8n) | BigInt(raw[offset + i])
  }
  if (x & (1n << 63n)) return x - (1n << 64n)
  return x
}

function encodeVarInt(n: number): Uint8Array {
  if (!Number.isSafeInteger(n) || n < 0) throw new Error('Invalid varint')
  if (n < 0xfd) return new Uint8Array([n])
  if (n <= 0xffff) {
    const out = new Uint8Array(3)
    out[0] = 0xfd
    const dv = new DataView(out.buffer)
    dv.setUint16(1, n, true)
    return out
  }
  if (n <= 0xffffffff) {
    return concatBytes(new Uint8Array([0xfe]), u32LE(n))
  }
  throw new Error('Varint too large')
}

function pushData(data: Uint8Array): Uint8Array {
  if (data.length > 0xff) throw new Error('Pushdata too large')
  return concatBytes(new Uint8Array([data.length]), data)
}

function reverseBytes(bytes: Uint8Array): Uint8Array {
  return Uint8Array.from(bytes).reverse()
}

function doubleSha256(data: Uint8Array): Uint8Array {
  return sha256(sha256(data))
}

function compactToDer(compactSig: Uint8Array): Uint8Array {
  if (compactSig.length !== 64) throw new Error('Invalid compact signature')
  const r = compactSig.slice(0, 32)
  const s = compactSig.slice(32, 64)

  const encodeInt = (value: Uint8Array): Uint8Array => {
    let i = 0
    while (i < value.length - 1 && value[i] === 0) i++
    const sliced = value.slice(i)
    // Create a new Uint8Array backed by ArrayBuffer to avoid type issues
    const bodyBuf = new ArrayBuffer(sliced.length)
    const body = new Uint8Array(bodyBuf)
    body.set(sliced)
    let result = body
    if (body[0] & 0x80) {
      const withPrefix = new Uint8Array(body.length + 1)
      withPrefix[0] = 0x00
      withPrefix.set(body, 1)
      result = withPrefix
    }
    const final = new Uint8Array(result.length + 2)
    final[0] = 0x02
    final[1] = result.length
    final.set(result, 2)
    return final
  }

  const derR = encodeInt(r)
  const derS = encodeInt(s)
  const seqLen = derR.length + derS.length
  const result = new Uint8Array(seqLen + 2)
  result[0] = 0x30
  result[1] = seqLen
  result.set(derR, 2)
  result.set(derS, 2 + derR.length)
  return result
}

function serializeTx(tx: TxData): Uint8Array {
  const inputBytes = tx.inputs.map((vin) => {
    const txidLE = reverseBytes(hexToBytes(vin.txid))
    return concatBytes(
      txidLE,
      u32LE(vin.vout),
      encodeVarInt(vin.scriptSig.length),
      vin.scriptSig,
      u32LE(vin.sequence)
    )
  })

  const outputBytes = tx.outputs.map((vout) =>
    concatBytes(
      u64LE(vout.amountSats),
      encodeVarInt(vout.scriptPubKey.length),
      vout.scriptPubKey
    )
  )

  return concatBytes(
    u32LE(tx.version),
    encodeVarInt(tx.inputs.length),
    ...inputBytes,
    encodeVarInt(tx.outputs.length),
    ...outputBytes,
    u32LE(tx.locktime)
  )
}

function signatureHashLegacy(
  tx: TxData,
  inputIndex: number,
  scriptCode: Uint8Array,
  hashType = SIGHASH_ALL
): Uint8Array {
  const tmp: TxData = {
    version: tx.version,
    inputs: tx.inputs.map((vin, i) => ({
      ...vin,
      scriptSig: i === inputIndex ? scriptCode : new Uint8Array()
    })),
    outputs: tx.outputs,
    locktime: tx.locktime
  }
  const payload = concatBytes(serializeTx(tmp), u32LE(hashType))
  return doubleSha256(payload)
}

function parseVarInt(raw: Uint8Array, offset: number): { value: number; nextOffset: number } {
  if (offset < 0 || offset >= raw.length) throw new Error('Invalid varint offset')
  const prefix = raw[offset]
  if (prefix < 0xfd) return { value: prefix, nextOffset: offset + 1 }
  if (prefix === 0xfd) {
    if (offset + 3 > raw.length) throw new Error('Unexpected EOF while reading varint(0xfd)')
    const dv = new DataView(raw.buffer, raw.byteOffset + offset + 1, 2)
    return { value: dv.getUint16(0, true), nextOffset: offset + 3 }
  }
  if (prefix === 0xfe) {
    if (offset + 5 > raw.length) throw new Error('Unexpected EOF while reading varint(0xfe)')
    const dv = new DataView(raw.buffer, raw.byteOffset + offset + 1, 4)
    return { value: dv.getUint32(0, true), nextOffset: offset + 5 }
  }
  if (prefix === 0xff) {
    if (offset + 9 > raw.length) throw new Error('Unexpected EOF while reading varint(0xff)')
    const dv = new DataView(raw.buffer, raw.byteOffset + offset + 1, 8)
    const value = Number(dv.getBigUint64(0, true))
    if (!Number.isSafeInteger(value)) throw new Error('Varint exceeds safe integer range')
    return { value, nextOffset: offset + 9 }
  }
  throw new Error('Invalid varint prefix')
}

function parseLegacyTx(unsignedHex: string): TxData {
  const hex = String(unsignedHex || '').trim()
  if (!hex || hex.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(hex)) {
    throw new Error('Invalid raw transaction hex')
  }
  const raw = hexToBytes(hex)
  let o = 0
  if (raw.length < 10) throw new Error('Raw transaction is too short')
  const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength)
  if (o + 4 > raw.length) throw new Error('Unexpected EOF while reading tx version')
  const version = dv.getUint32(o, true)
  o += 4

  const vinCount = parseVarInt(raw, o)
  o = vinCount.nextOffset
  const inputs: TxInput[] = []
  for (let i = 0; i < vinCount.value; i++) {
    if (o + 32 + 4 > raw.length) throw new Error('Unexpected EOF while reading tx input')
    const txid = bytesToHex(reverseBytes(raw.slice(o, o + 32)))
    o += 32
    const vout = dv.getUint32(o, true)
    o += 4
    const scriptLen = parseVarInt(raw, o)
    o = scriptLen.nextOffset
    if (o + scriptLen.value + 4 > raw.length) throw new Error('Unexpected EOF while reading input script/sequence')
    const scriptSig = raw.slice(o, o + scriptLen.value)
    o += scriptLen.value
    const sequence = dv.getUint32(o, true)
    o += 4
    inputs.push({ txid, vout, scriptSig, sequence })
  }

  const voutCount = parseVarInt(raw, o)
  o = voutCount.nextOffset
  const outputs: TxOutput[] = []
  for (let i = 0; i < voutCount.value; i++) {
    if (o + 8 > raw.length) throw new Error('Unexpected EOF while reading tx output amount')
    const amount = Number(dv.getBigUint64(o, true))
    o += 8
    const scriptLen = parseVarInt(raw, o)
    o = scriptLen.nextOffset
    if (o + scriptLen.value > raw.length) throw new Error('Unexpected EOF while reading output script')
    const scriptPubKey = raw.slice(o, o + scriptLen.value)
    o += scriptLen.value
    outputs.push({ amountSats: amount, scriptPubKey })
  }

  if (o + 4 > raw.length) throw new Error('Unexpected EOF while reading locktime')
  const locktime = dv.getUint32(o, true)
  return { version, inputs, outputs, locktime }
}

export interface UnsignedTxInput {
  txid: string
  vout: number
  sequence?: number
  scriptPubKeyHex: string
  amountSats: number
}

export async function signLegacyP2pkhTransaction(
  unsignedHex: string,
  inputs: UnsignedTxInput[],
  privateKeyHex: string
): Promise<string> {
  let tx: TxData
  try {
    tx = parseLegacyTx(unsignedHex)
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error ?? 'unknown parse error')
    throw new Error(`Failed to parse unsigned legacy transaction: ${msg}`)
  }
  if (tx.inputs.length !== inputs.length) {
    throw new Error('Prepared transaction input count mismatch')
  }

  const priv = hexToBytes(privateKeyHex)
  const pub = secp.getPublicKey(priv, true) // compressed public key

  const signedInputs: TxInput[] = []
  for (let i = 0; i < tx.inputs.length; i++) {
    const vin = tx.inputs[i]
    const prev = inputs[i]
    if (vin.txid !== prev.txid || vin.vout !== prev.vout) {
      throw new Error('Prepared transaction input outpoint mismatch')
    }

    const scriptCode = hexToBytes(prev.scriptPubKeyHex)
    const sighash = signatureHashLegacy(tx, i, scriptCode, SIGHASH_ALL)
    const compactSig = secp.sign(sighash, priv, { prehash: false, lowS: true, format: 'compact' })
    const derPlusType = concatBytes(compactToDer(compactSig), new Uint8Array([SIGHASH_ALL]))
    const scriptSig = concatBytes(pushData(derPlusType), pushData(pub))

    signedInputs.push({
      ...vin,
      scriptSig
    })
  }
  tx.inputs = signedInputs

  return bytesToHex(serializeTx(tx))
}

interface BtczTxInput {
  txid: string
  prevTxIdLe: Uint8Array
  vout: number
  scriptSig: Uint8Array
  sequence: number
}

interface BtczTxOutput {
  amountSats: number
  scriptPubKey: Uint8Array
}

interface BtczTxData {
  rawHeader: number
  version: number
  versionGroupId: number
  isSapling: boolean
  inputs: BtczTxInput[]
  outputs: BtczTxOutput[]
  locktime: number
  expiryHeight: number
  valueBalance: bigint
  shieldedSpendCount: number
  shieldedOutputCount: number
  joinSplitCount: number
}

const BTCZ_OVERWINTER_VERSION_GROUP_ID = 0x03c48270
const BTCZ_SAPLING_VERSION_GROUP_ID = 0x892f2085
const BTCZ_DEFAULT_CONSENSUS_BRANCH_ID = 0x76b809bb

function asciiBytes(input: string): Uint8Array {
  return Uint8Array.from(Array.from(input).map((ch) => ch.charCodeAt(0)))
}

const BTCZ_PERS_PREVOUT = asciiBytes('ZcashPrevoutHash')
const BTCZ_PERS_SEQUENCE = asciiBytes('ZcashSequencHash')
const BTCZ_PERS_OUTPUTS = asciiBytes('ZcashOutputsHash')
const BTCZ_SIGHASH_PREFIX = asciiBytes('ZcashSigHash')

function blake2bPersonalized(data: Uint8Array, personalization: Uint8Array): Uint8Array {
  if (personalization.length !== 16) throw new Error('BLAKE2b personalization must be 16 bytes')
  return blake2b(data, { dkLen: 32, personalization })
}

function serializeBtczOutpoint(vin: BtczTxInput): Uint8Array {
  return concatBytes(vin.prevTxIdLe, u32LE(vin.vout))
}

function serializeBtczOutput(vout: BtczTxOutput): Uint8Array {
  return concatBytes(
    u64LE(vout.amountSats),
    encodeVarInt(vout.scriptPubKey.length),
    vout.scriptPubKey
  )
}

function parseBtczTransparentTx(unsignedHex: string): BtczTxData {
  const hex = String(unsignedHex || '').trim()
  if (!hex || hex.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(hex)) {
    throw new Error('Invalid BTCZ raw transaction hex')
  }

  const raw = hexToBytes(hex)
  if (raw.length < 20) throw new Error('BTCZ raw transaction is too short')
  const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength)
  let o = 0

  if (o + 4 > raw.length) throw new Error('Unexpected EOF while reading BTCZ header')
  const rawHeader = dv.getUint32(o, true)
  o += 4
  const overwintered = (rawHeader >>> 31) === 1
  const version = rawHeader & 0x7fffffff
  if (!overwintered) throw new Error('BTCZ transaction is not Overwinter/Sapling format')

  if (o + 4 > raw.length) throw new Error('Unexpected EOF while reading BTCZ versionGroupId')
  const versionGroupId = dv.getUint32(o, true)
  o += 4

  const isOverwinterV3 = version === 3 && versionGroupId === BTCZ_OVERWINTER_VERSION_GROUP_ID
  const isSaplingV4 = version === 4 && versionGroupId === BTCZ_SAPLING_VERSION_GROUP_ID
  if (!isOverwinterV3 && !isSaplingV4) throw new Error('Unsupported BTCZ transaction version/group')

  const vinCount = parseVarInt(raw, o)
  o = vinCount.nextOffset
  const inputs: BtczTxInput[] = []
  for (let i = 0; i < vinCount.value; i++) {
    if (o + 36 > raw.length) throw new Error('Unexpected EOF while reading BTCZ input outpoint')
    const prevTxIdLe = raw.slice(o, o + 32)
    const txid = bytesToHex(reverseBytes(prevTxIdLe))
    o += 32
    const vout = dv.getUint32(o, true)
    o += 4
    const scriptLen = parseVarInt(raw, o)
    o = scriptLen.nextOffset
    if (o + scriptLen.value + 4 > raw.length) throw new Error('Unexpected EOF while reading BTCZ input script/sequence')
    const scriptSig = raw.slice(o, o + scriptLen.value)
    o += scriptLen.value
    const sequence = dv.getUint32(o, true)
    o += 4
    inputs.push({ txid, prevTxIdLe, vout, scriptSig, sequence })
  }

  const voutCount = parseVarInt(raw, o)
  o = voutCount.nextOffset
  const outputs: BtczTxOutput[] = []
  for (let i = 0; i < voutCount.value; i++) {
    if (o + 8 > raw.length) throw new Error('Unexpected EOF while reading BTCZ output amount')
    const amountSats = Number(dv.getBigUint64(o, true))
    o += 8
    const scriptLen = parseVarInt(raw, o)
    o = scriptLen.nextOffset
    if (o + scriptLen.value > raw.length) throw new Error('Unexpected EOF while reading BTCZ output script')
    const scriptPubKey = raw.slice(o, o + scriptLen.value)
    o += scriptLen.value
    outputs.push({ amountSats, scriptPubKey })
  }

  if (o + 4 > raw.length) throw new Error('Unexpected EOF while reading BTCZ locktime')
  const locktime = dv.getUint32(o, true)
  o += 4

  if (o + 4 > raw.length) throw new Error('Unexpected EOF while reading BTCZ expiryHeight')
  const expiryHeight = dv.getUint32(o, true)
  o += 4

  let valueBalance = 0n
  let shieldedSpendCount = 0
  let shieldedOutputCount = 0
  if (isSaplingV4) {
    valueBalance = readI64LE(raw, o)
    o += 8
    const spends = parseVarInt(raw, o)
    shieldedSpendCount = spends.value
    o = spends.nextOffset
    if (shieldedSpendCount !== 0) throw new Error('Unsupported BTCZ transaction: shielded spends are not supported')
    const outputsCount = parseVarInt(raw, o)
    shieldedOutputCount = outputsCount.value
    o = outputsCount.nextOffset
    if (shieldedOutputCount !== 0) throw new Error('Unsupported BTCZ transaction: shielded outputs are not supported')
  }

  let joinSplitCount = 0
  if (version >= 2) {
    const joinSplits = parseVarInt(raw, o)
    joinSplitCount = joinSplits.value
    o = joinSplits.nextOffset
    if (joinSplitCount !== 0) throw new Error('Unsupported BTCZ transaction: JoinSplits are not supported')
  }

  if (o !== raw.length) throw new Error('Unsupported BTCZ transaction payload after transparent section')

  return {
    rawHeader,
    version,
    versionGroupId,
    isSapling: isSaplingV4,
    inputs,
    outputs,
    locktime,
    expiryHeight,
    valueBalance,
    shieldedSpendCount,
    shieldedOutputCount,
    joinSplitCount
  }
}

function serializeBtczTransparentTx(tx: BtczTxData): Uint8Array {
  if (tx.shieldedSpendCount !== 0 || tx.shieldedOutputCount !== 0 || tx.joinSplitCount !== 0) {
    throw new Error('Unsupported BTCZ transaction: non-transparent fields are not supported')
  }

  const inputBytes = tx.inputs.map((vin) => (
    concatBytes(
      serializeBtczOutpoint(vin),
      encodeVarInt(vin.scriptSig.length),
      vin.scriptSig,
      u32LE(vin.sequence)
    )
  ))

  const outputBytes = tx.outputs.map((vout) => serializeBtczOutput(vout))

  const parts: Uint8Array[] = [
    u32LE(tx.rawHeader),
    u32LE(tx.versionGroupId),
    encodeVarInt(tx.inputs.length),
    ...inputBytes,
    encodeVarInt(tx.outputs.length),
    ...outputBytes,
    u32LE(tx.locktime),
    u32LE(tx.expiryHeight)
  ]

  if (tx.isSapling) {
    parts.push(i64LE(tx.valueBalance))
    parts.push(encodeVarInt(tx.shieldedSpendCount))
    parts.push(encodeVarInt(tx.shieldedOutputCount))
  }
  if (tx.version >= 2) {
    parts.push(encodeVarInt(tx.joinSplitCount))
  }

  return concatBytes(...parts)
}

function buildBtczSigHashPersonalization(consensusBranchId: number): Uint8Array {
  const out = new Uint8Array(16)
  out.set(BTCZ_SIGHASH_PREFIX, 0)
  out.set(u32LE(consensusBranchId >>> 0), 12)
  return out
}

function signatureHashBtczTransparent(
  tx: BtczTxData,
  inputIndex: number,
  scriptCode: Uint8Array,
  amountSats: number,
  consensusBranchId: number,
  hashType = SIGHASH_ALL
): Uint8Array {
  if (inputIndex < 0 || inputIndex >= tx.inputs.length) throw new Error('BTCZ input index out of range')
  if (!Number.isSafeInteger(amountSats) || amountSats < 0) throw new Error('Invalid BTCZ input amount')

  const hashPrevouts = blake2bPersonalized(
    concatBytes(...tx.inputs.map((vin) => serializeBtczOutpoint(vin))),
    BTCZ_PERS_PREVOUT
  )
  const hashSequence = blake2bPersonalized(
    concatBytes(...tx.inputs.map((vin) => u32LE(vin.sequence))),
    BTCZ_PERS_SEQUENCE
  )
  const hashOutputs = blake2bPersonalized(
    concatBytes(...tx.outputs.map((vout) => serializeBtczOutput(vout))),
    BTCZ_PERS_OUTPUTS
  )
  const hashJoinSplits = new Uint8Array(32)
  const hashShieldedSpends = new Uint8Array(32)
  const hashShieldedOutputs = new Uint8Array(32)

  const vin = tx.inputs[inputIndex]
  const preimageParts: Uint8Array[] = [
    u32LE(tx.rawHeader),
    u32LE(tx.versionGroupId),
    hashPrevouts,
    hashSequence,
    hashOutputs,
    hashJoinSplits
  ]

  if (tx.isSapling) {
    preimageParts.push(hashShieldedSpends)
    preimageParts.push(hashShieldedOutputs)
  }

  preimageParts.push(u32LE(tx.locktime))
  preimageParts.push(u32LE(tx.expiryHeight))
  if (tx.isSapling) {
    preimageParts.push(i64LE(tx.valueBalance))
  }
  preimageParts.push(u32LE(hashType >>> 0))
  preimageParts.push(serializeBtczOutpoint(vin))
  preimageParts.push(encodeVarInt(scriptCode.length))
  preimageParts.push(scriptCode)
  preimageParts.push(i64LE(BigInt(amountSats)))
  preimageParts.push(u32LE(vin.sequence))

  const preimage = concatBytes(...preimageParts)
  return blake2bPersonalized(preimage, buildBtczSigHashPersonalization(consensusBranchId))
}

export async function signBtczTransparentTransaction(
  unsignedHex: string,
  inputs: UnsignedTxInput[],
  privateKeyHex: string,
  options?: { consensusBranchId?: number }
): Promise<string> {
  const tx = parseBtczTransparentTx(unsignedHex)
  if (tx.inputs.length !== inputs.length) {
    throw new Error('Prepared BTCZ transaction input count mismatch')
  }

  const priv = hexToBytes(privateKeyHex)
  const pub = secp.getPublicKey(priv, true)
  const consensusBranchId = Number(options?.consensusBranchId ?? BTCZ_DEFAULT_CONSENSUS_BRANCH_ID) >>> 0

  const signedInputs: BtczTxInput[] = []
  for (let i = 0; i < tx.inputs.length; i++) {
    const vin = tx.inputs[i]
    const prev = inputs[i]
    if (vin.txid !== prev.txid || vin.vout !== prev.vout) {
      throw new Error('Prepared BTCZ input outpoint mismatch')
    }
    const scriptCode = hexToBytes(prev.scriptPubKeyHex)
    const sighash = signatureHashBtczTransparent(
      tx,
      i,
      scriptCode,
      prev.amountSats,
      consensusBranchId,
      SIGHASH_ALL
    )
    const compactSig = secp.sign(sighash, priv, { prehash: false, lowS: true, format: 'compact' })
    const derPlusType = concatBytes(compactToDer(compactSig), new Uint8Array([SIGHASH_ALL]))
    const scriptSig = concatBytes(pushData(derPlusType), pushData(pub))
    signedInputs.push({ ...vin, scriptSig })
  }

  tx.inputs = signedInputs
  return bytesToHex(serializeBtczTransparentTx(tx))
}
