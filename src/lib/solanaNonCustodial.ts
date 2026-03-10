import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  Transaction,
  TransactionInstruction
} from '@solana/web3.js'
import { hexToBytes } from '@noble/hashes/utils'

const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA')
const TOKEN_2022_PROGRAM_ID = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb')
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey('ATokenGPvbdGVxr1Q2hvZbsiqW5xWH25efTNsLJA8knL')
const METADATA_PROGRAM_ID = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s')

function readEnvFlag(name: string, fallback = false): boolean {
  const env = ((import.meta as any)?.env || {}) as Record<string, unknown>
  const raw = String(env?.[name] ?? '').trim().toLowerCase()
  if (!raw) return fallback
  if (['1', 'true', 'yes', 'on'].includes(raw)) return true
  if (['0', 'false', 'no', 'off'].includes(raw)) return false
  return fallback
}

const SOL_ALLOW_PUBLIC_RPC_FALLBACK = readEnvFlag('VITE_SOL_ALLOW_PUBLIC_RPC_FALLBACK', false)

function resolveSolanaRpcCandidates(rpcUrl: string): string[] {
  const primary = String(rpcUrl || '').trim()
  const defaults = SOL_ALLOW_PUBLIC_RPC_FALLBACK
    ? ['https://api.mainnet-beta.solana.com', 'https://solana-rpc.publicnode.com']
    : []
  return Array.from(new Set([primary, ...defaults].filter(Boolean)))
}

function parseSolAmount(amount: string): bigint {
  const raw = String(amount || '').trim()
  if (!/^\d+(\.\d+)?$/.test(raw)) throw new Error('Invalid SOL amount')
  const [whole, frac = ''] = raw.split('.')
  if (frac.length > 9) throw new Error('SOL supports up to 9 decimals')
  const lamports = BigInt(`${whole}${frac.padEnd(9, '0')}`.replace(/^0+/, '') || '0')
  if (lamports <= 0n) throw new Error('Amount must be greater than 0')
  return lamports
}

export async function getSolanaBalance(rpcUrl: string, address: string): Promise<string> {
  const pubkey = new PublicKey(String(address || '').trim())
  let lastError: unknown = null
  let firstSuccessful: string | null = null
  for (const candidate of resolveSolanaRpcCandidates(rpcUrl)) {
    try {
      const connection = new Connection(candidate, 'confirmed')
      const lamports = await connection.getBalance(pubkey, 'confirmed')
      const formatted = (lamports / LAMPORTS_PER_SOL).toFixed(9).replace(/\.?0+$/, '')
      if (firstSuccessful == null) firstSuccessful = formatted
      if (lamports > 0) return formatted
    } catch (error) {
      lastError = error
    }
  }
  if (firstSuccessful != null) return firstSuccessful
  throw lastError instanceof Error ? lastError : new Error('Failed to query Solana balance from configured RPC endpoints')
}

function parseTokenAmount(amount: string, decimals: number): bigint {
  const raw = String(amount || '').trim()
  if (!/^\d+(\.\d+)?$/.test(raw)) throw new Error('Invalid SPL token amount')
  const [whole, frac = ''] = raw.split('.')
  if (frac.length > decimals) throw new Error(`Token supports up to ${decimals} decimals`)
  const asRaw = BigInt(`${whole}${frac.padEnd(decimals, '0')}`.replace(/^0+/, '') || '0')
  if (asRaw <= 0n) throw new Error('Token amount must be greater than 0')
  return asRaw
}

function toU64LE(value: bigint): Buffer {
  const out = Buffer.alloc(8)
  let v = value
  for (let i = 0; i < 8; i += 1) {
    out[i] = Number(v & 0xffn)
    v >>= 8n
  }
  return out
}

function normalizeMintAddress(assetId: string): string {
  const raw = String(assetId || '').trim()
  if (!raw) return ''
  const byColon = raw.split(':')
  const candidate = byColon[byColon.length - 1] || ''
  return candidate.trim()
}

function getAssociatedTokenAddress(owner: PublicKey, mint: PublicKey, tokenProgram: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [owner.toBuffer(), tokenProgram.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID
  )[0]
}

function createAssociatedTokenAccountInstruction(
  payer: PublicKey,
  ata: PublicKey,
  owner: PublicKey,
  mint: PublicKey,
  tokenProgram: PublicKey
): TransactionInstruction {
  return new TransactionInstruction({
    programId: ASSOCIATED_TOKEN_PROGRAM_ID,
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: ata, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: false, isWritable: false },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: tokenProgram, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false }
    ],
    data: Buffer.alloc(0)
  })
}

function createTransferCheckedInstruction(
  sourceAta: PublicKey,
  mint: PublicKey,
  destinationAta: PublicKey,
  owner: PublicKey,
  amountRaw: bigint,
  decimals: number,
  tokenProgram: PublicKey
): TransactionInstruction {
  const data = Buffer.concat([
    Buffer.from([12]), // TransferChecked
    toU64LE(amountRaw),
    Buffer.from([decimals & 0xff])
  ])
  return new TransactionInstruction({
    programId: tokenProgram,
    keys: [
      { pubkey: sourceAta, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: destinationAta, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: true, isWritable: false }
    ],
    data
  })
}

async function withSolanaConnection<T>(rpcUrl: string, task: (connection: Connection) => Promise<T>): Promise<T> {
  let lastError: unknown = null
  for (const candidate of resolveSolanaRpcCandidates(rpcUrl)) {
    try {
      const connection = new Connection(candidate, 'confirmed')
      return await task(connection)
    } catch (error) {
      lastError = error
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Solana RPC request failed')
}

async function resolveMintMetadata(connection: Connection, mint: PublicKey): Promise<{ decimals: number; tokenProgram: PublicKey }> {
  const info = await connection.getParsedAccountInfo(mint, 'confirmed')
  const owner = info.value?.owner
  const tokenProgram = owner?.equals(TOKEN_2022_PROGRAM_ID)
    ? TOKEN_2022_PROGRAM_ID
    : TOKEN_PROGRAM_ID
  const parsed = (info.value?.data as any)?.parsed
  const decimals = Number(parsed?.info?.decimals ?? 0)
  if (!Number.isFinite(decimals) || decimals < 0 || decimals > 18) {
    throw new Error('Invalid mint decimals')
  }
  return { decimals: Math.trunc(decimals), tokenProgram }
}

export type SolanaTokenBalanceRow = {
  tokenId: string
  amountRaw: string
  amountUi: string
  decimals: number
  tokenProgram: string
  isNft: boolean
  symbol?: string
  name?: string
}

async function fetchJsonRpc(endpoint: string, method: string, params: any[]): Promise<any> {
  const body = {
    jsonrpc: '2.0',
    id: 1,
    method,
    params
  }
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  })
  if (!response.ok) throw new Error(`Solana RPC HTTP ${response.status} @ ${endpoint}`)
  const json = await response.json().catch(() => null)
  if (!json || json.error) {
    throw new Error(`Solana RPC error @ ${endpoint}: ${JSON.stringify(json?.error || json)}`)
  }
  return json.result
}

async function fetchTokenRowsViaHttpRpc(endpoint: string, owner: string, programId: string): Promise<SolanaTokenBalanceRow[]> {
  const result = await fetchJsonRpc(endpoint, 'getTokenAccountsByOwner', [
    owner,
    { programId },
    { encoding: 'jsonParsed', commitment: 'confirmed' }
  ])
  const rows = Array.isArray(result?.value) ? result.value : []
  const out: SolanaTokenBalanceRow[] = []
  for (const row of rows) {
    const parsed = row?.account?.data?.parsed?.info
    const mint = String(parsed?.mint || '').trim()
    const tokenAmount = parsed?.tokenAmount || {}
    const amountRaw = String(tokenAmount?.amount || '').trim()
    const amountUi = String(tokenAmount?.uiAmountString || '').trim()
    const decimals = Number(tokenAmount?.decimals ?? 0)
    if (!mint || !/^\d+$/.test(amountRaw)) continue
    const rawBig = BigInt(amountRaw)
    if (rawBig <= 0n) continue
    out.push({
      tokenId: mint,
      amountRaw,
      amountUi: amountUi || '0',
      decimals: Number.isFinite(decimals) ? Math.max(0, Math.trunc(decimals)) : 0,
      tokenProgram: programId,
      isNft: decimals === 0 && rawBig === 1n
    })
  }
  return out
}

function readU32LE(buffer: Buffer, offset: number): number {
  if (offset + 4 > buffer.length) return 0
  return buffer.readUInt32LE(offset)
}

function readBorshString(buffer: Buffer, offset: number): { value: string; next: number } {
  const len = readU32LE(buffer, offset)
  const start = offset + 4
  const end = Math.min(buffer.length, start + Math.max(0, len))
  const value = buffer.slice(start, end).toString('utf8').replace(/\0/g, '').trim()
  return { value, next: end }
}

async function readMetaplexTokenMetadata(
  connection: Connection,
  mint: PublicKey
): Promise<{ symbol?: string; name?: string }> {
  try {
    const [pda] = PublicKey.findProgramAddressSync(
      [Buffer.from('metadata'), METADATA_PROGRAM_ID.toBuffer(), mint.toBuffer()],
      METADATA_PROGRAM_ID
    )
    const info = await connection.getAccountInfo(pda, 'confirmed')
    if (!info?.data || info.data.length < 70) return {}
    const data = Buffer.from(info.data)

    // Metadata account layout: key(1) + updateAuthority(32) + mint(32) + Data{name,symbol,uri,...}
    let cursor = 1 + 32 + 32
    const namePart = readBorshString(data, cursor)
    cursor = namePart.next
    const symbolPart = readBorshString(data, cursor)
    const name = String(namePart.value || '').trim()
    const symbol = String(symbolPart.value || '').trim().toUpperCase()
    return {
      name: name || undefined,
      symbol: symbol || undefined
    }
  } catch {
    return {}
  }
}

export async function listSolanaTokenBalances(rpcUrl: string, ownerAddress: string): Promise<SolanaTokenBalanceRow[]> {
  const owner = new PublicKey(String(ownerAddress || '').trim())
  const ownerBase58 = owner.toBase58()
  let lastError: unknown = null
  let firstSuccessful: SolanaTokenBalanceRow[] | null = null
  for (const candidate of resolveSolanaRpcCandidates(rpcUrl)) {
    try {
      const connection = new Connection(candidate, 'confirmed')
      const programs = [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID]
      const rows: SolanaTokenBalanceRow[] = []
      const metadataByMint = new Map<string, { symbol?: string; name?: string }>()
      for (const programId of programs) {
        const result = await connection.getParsedTokenAccountsByOwner(owner, { programId }, 'confirmed')
        for (const accountRow of result.value) {
          const parsed = (accountRow.account.data as any)?.parsed?.info
          const mint = String(parsed?.mint || '').trim()
          const tokenAmount = parsed?.tokenAmount
          const amountRaw = String(tokenAmount?.amount || '').trim()
          const amountUi = String(tokenAmount?.uiAmountString || '').trim()
          const decimals = Number(tokenAmount?.decimals ?? 0)
          if (!mint || !/^\d+$/.test(amountRaw)) continue
          const rawBig = BigInt(amountRaw)
          if (rawBig <= 0n) continue
          let metadata = metadataByMint.get(mint)
          if (!metadata) {
            metadata = await readMetaplexTokenMetadata(connection, new PublicKey(mint))
            metadataByMint.set(mint, metadata)
          }
          rows.push({
            tokenId: mint,
            amountRaw,
            amountUi: amountUi || '0',
            decimals: Number.isFinite(decimals) ? Math.max(0, Math.trunc(decimals)) : 0,
            tokenProgram: programId.toBase58(),
            isNft: decimals === 0 && rawBig === 1n,
            symbol: metadata.symbol,
            name: metadata.name
          })
        }
      }
      if (firstSuccessful == null) firstSuccessful = rows
      if (rows.length > 0) return rows
    } catch (error) {
      lastError = error
    }
  }
  // Optional public fallback for deployments that intentionally allow it.
  if (SOL_ALLOW_PUBLIC_RPC_FALLBACK) {
    try {
      const fallbackEndpoints = ['https://api.mainnet-beta.solana.com', 'https://solana-rpc.publicnode.com']
      for (const endpoint of fallbackEndpoints) {
        const tokenkegRows = await fetchTokenRowsViaHttpRpc(endpoint, ownerBase58, TOKEN_PROGRAM_ID.toBase58())
        const token2022Rows = await fetchTokenRowsViaHttpRpc(endpoint, ownerBase58, TOKEN_2022_PROGRAM_ID.toBase58())
        const merged = [...tokenkegRows, ...token2022Rows]
        if (firstSuccessful == null) firstSuccessful = merged
        if (merged.length > 0) return merged
      }
    } catch (error) {
      lastError = error
    }
  }
  if (firstSuccessful != null) return firstSuccessful
  if (lastError) throw lastError instanceof Error ? lastError : new Error('Failed to list Solana token balances')
  return []
}

export async function sendSolanaSplTokenNonCustodial(params: {
  rpcUrl: string
  fromAddress: string
  toAddress: string
  assetId: string
  amount: string
  privateKeyHex: string
}): Promise<{ hash: string }> {
  const fromAddress = String(params.fromAddress || '').trim()
  const toAddress = String(params.toAddress || '').trim()
  const mintAddress = normalizeMintAddress(params.assetId)
  if (!fromAddress) throw new Error('Solana sender address is required')
  if (!toAddress) throw new Error('Solana destination address is required')
  if (!mintAddress) throw new Error('SPL token mint address is required')

  const sender = Keypair.fromSeed(hexToBytes(String(params.privateKeyHex || '').trim()))
  const senderAddress = sender.publicKey.toBase58()
  if (senderAddress !== fromAddress) {
    throw new Error(`Derived SOL signer does not match active address (${senderAddress} != ${fromAddress})`)
  }

  const recipient = new PublicKey(toAddress)
  const mint = new PublicKey(mintAddress)

  return await withSolanaConnection(params.rpcUrl, async (connection) => {
    const { decimals, tokenProgram } = await resolveMintMetadata(connection, mint)
    const amountRaw = parseTokenAmount(params.amount, decimals)
    const sourceAta = getAssociatedTokenAddress(sender.publicKey, mint, tokenProgram)
    const destinationAta = getAssociatedTokenAddress(recipient, mint, tokenProgram)

    const sourceInfo = await connection.getParsedAccountInfo(sourceAta, 'confirmed')
    if (!sourceInfo.value) {
      throw new Error('Sender token account not found for the selected mint')
    }
    const sourceAmountRaw = String(((sourceInfo.value.data as any)?.parsed?.info?.tokenAmount?.amount) || '0').trim()
    const sourceAmount = /^\d+$/.test(sourceAmountRaw) ? BigInt(sourceAmountRaw) : 0n
    if (sourceAmount < amountRaw) {
      throw new Error('Insufficient token balance')
    }

    const tx = new Transaction()
    const destinationInfo = await connection.getAccountInfo(destinationAta, 'confirmed')
    if (!destinationInfo) {
      tx.add(createAssociatedTokenAccountInstruction(
        sender.publicKey,
        destinationAta,
        recipient,
        mint,
        tokenProgram
      ))
    }

    tx.add(createTransferCheckedInstruction(
      sourceAta,
      mint,
      destinationAta,
      sender.publicKey,
      amountRaw,
      decimals,
      tokenProgram
    ))

    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed')
    tx.feePayer = sender.publicKey
    tx.recentBlockhash = blockhash
    tx.sign(sender)
    const signature = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false })
    await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'confirmed')
    return { hash: signature }
  })
}

export async function sendSolanaNonCustodial(params: {
  rpcUrl: string
  fromAddress: string
  toAddress: string
  amountSol: string
  privateKeyHex: string
}): Promise<{ hash: string }> {
  const fromAddress = String(params.fromAddress || '').trim()
  const toAddress = String(params.toAddress || '').trim()
  if (!fromAddress) throw new Error('Solana sender address is required')
  if (!toAddress) throw new Error('Solana destination address is required')

  const sender = Keypair.fromSeed(hexToBytes(String(params.privateKeyHex || '').trim()))
  const senderAddress = sender.publicKey.toBase58()
  if (senderAddress !== fromAddress) {
    throw new Error(`Derived SOL signer does not match active address (${senderAddress} != ${fromAddress})`)
  }

  const lamports = parseSolAmount(params.amountSol)
  const amountLamports = Number(lamports)
  if (!Number.isFinite(amountLamports) || amountLamports <= 0) throw new Error('Invalid SOL amount')

  return await withSolanaConnection(params.rpcUrl, async (connection) => {
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed')
    const tx = new Transaction({
      feePayer: sender.publicKey,
      recentBlockhash: blockhash
    }).add(
      SystemProgram.transfer({
        fromPubkey: sender.publicKey,
        toPubkey: new PublicKey(toAddress),
        lamports: amountLamports
      })
    )
    tx.sign(sender)
    const signature = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false })
    await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'confirmed')
    return { hash: signature }
  })
}
