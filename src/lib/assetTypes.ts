export type SolanaAssetType = 'spl-token' | 'spl-nft' | 'compressed-nft'

function normalizeText(value: unknown): string {
  return String(value || '').trim()
}

export function isEvmNftAssetKey(assetId: string): boolean {
  return /^EVMNFT:(erc721|erc1155):0x[a-fA-F0-9]{40}:.+$/.test(normalizeText(assetId))
}

export function extractSolanaMintFromAssetId(assetId: string): string {
  const raw = normalizeText(assetId)
  if (!raw) return ''
  const parts = raw.split(':').map((part) => part.trim()).filter(Boolean)
  return parts[parts.length - 1] || ''
}

export function parseSolanaAssetType(assetId: string): SolanaAssetType {
  const raw = normalizeText(assetId)
  if (!raw) return 'spl-token'
  const lower = raw.toLowerCase()

  if (lower.startsWith('solnft:compressed:')) return 'compressed-nft'
  if (lower.startsWith('solnft:spl:')) return 'spl-nft'
  if (lower.startsWith('solana:compressed-nft:')) return 'compressed-nft'
  if (lower.startsWith('solana:spl-nft:')) return 'spl-nft'
  if (lower.startsWith('solana:spl-token:')) return 'spl-token'
  if (lower.startsWith('cnft:') || lower.includes(':cnft:') || lower.includes('compressed')) return 'compressed-nft'
  if (lower.startsWith('splnft:') || lower.includes(':nft:') || lower.startsWith('nft:')) return 'spl-nft'
  return 'spl-token'
}

export function buildSolanaAssetId(mint: string, type: SolanaAssetType): string {
  const normalizedMint = normalizeText(mint)
  if (!normalizedMint) return ''
  if (type === 'compressed-nft') return `SOLNFT:compressed:${normalizedMint}`
  if (type === 'spl-nft') return `SOLNFT:spl:${normalizedMint}`
  return normalizedMint
}

export function resolveSolanaAssetTypeLabel(assetId: string): string {
  const type = parseSolanaAssetType(assetId)
  if (type === 'spl-nft') return 'SPL NFT'
  if (type === 'compressed-nft') return 'Compressed NFT'
  return 'SPL Token'
}

