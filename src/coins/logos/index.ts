import { bundledWalletLogos } from 'virtual:wallet-logo-registry'

type PlaceholderPalette = {
  bg: string
  ring: string
  icon: string
}

type PlaceholderIcon = 'layers' | 'cube' | 'tag'
type PlaceholderKind = 'coin' | 'token'

const PLACEHOLDER_PALETTES: PlaceholderPalette[] = [
  { bg: '#2f1f0d', ring: '#f59e0b', icon: '#fbbf24' },
  { bg: '#0f2230', ring: '#3b82f6', icon: '#60a5fa' },
  { bg: '#14261b', ring: '#22c55e', icon: '#4ade80' },
  { bg: '#2c1b2e', ring: '#d946ef', icon: '#e879f9' },
  { bg: '#2b1b17', ring: '#f97316', icon: '#fb923c' }
]

const placeholderByKey = new Map<string, string>()

function splitAssetName(name: string): { root: string; sub: string | null } {
  const pipeIdx = name.indexOf('|')
  if (pipeIdx >= 0) return { root: name.slice(0, pipeIdx).trim(), sub: name.slice(pipeIdx + 1).trim() || null }
  const slashIdx = name.indexOf('/')
  if (slashIdx >= 0) return { root: name.slice(0, slashIdx).trim(), sub: name.slice(slashIdx + 1).trim() || null }
  return { root: name.trim(), sub: null }
}

function variantsOf(value: string): string[] {
  const trimmed = String(value || '').trim()
  if (!trimmed) return []
  const lower = trimmed.toLowerCase()
  const compact = lower.replace(/[^a-z0-9]/g, '')
  const dashed = lower.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  const underscored = lower.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  return Array.from(new Set([lower, compact, dashed, underscored].filter(Boolean)))
}

function hashString(value: string): number {
  let hash = 0
  for (let i = 0; i < value.length; i += 1) {
    hash = ((hash * 31) + value.charCodeAt(i)) >>> 0
  }
  return hash
}

function getPlaceholderIconMarkup(icon: PlaceholderIcon, color: string): string {
  if (icon === 'cube') {
    return `<path d="M32 15.5 20 22v12l12 6.5L44 34V22l-12-6.5Zm0 2.7 8.8 4.8-8.8 4.8-8.8-4.8 8.8-4.8Zm-10 7.6 9 4.9v7.5l-9-4.9v-7.5Zm20 0v7.5l-9 4.9v-7.5l9-4.9Z" fill="${color}"/>`
  }
  if (icon === 'tag') {
    return `<path d="M20 15h12.4L43 25.7 32.6 36H20c-2.8 0-5-2.2-5-5V20c0-2.8 2.2-5 5-5Zm10 4.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Z" fill="${color}"/>`
  }
  return `<path d="M18 18.5c0-1.4 1.1-2.5 2.5-2.5h23c1.4 0 2.5 1.1 2.5 2.5S44.9 21 43.5 21h-23c-1.4 0-2.5-1.1-2.5-2.5Zm-4 7c0-1.4 1.1-2.5 2.5-2.5h23c1.4 0 2.5 1.1 2.5 2.5S40.9 28 39.5 28h-23c-1.4 0-2.5-1.1-2.5-2.5Zm4 7c0-1.4 1.1-2.5 2.5-2.5h23c1.4 0 2.5 1.1 2.5 2.5S44.9 35 43.5 35h-23c-1.4 0-2.5-1.1-2.5-2.5Z" fill="${color}"/>`
}

function resolvePlaceholderIcon(kind: PlaceholderKind): PlaceholderIcon {
  return kind === 'token' ? 'tag' : 'layers'
}

function createSystemPlaceholderLogo(name: string, kind: PlaceholderKind = 'coin'): string {
  const raw = String(name || '').trim() || 'asset'
  const normalized = variantsOf(raw)[0] || raw.toLowerCase()
  const cacheKey = `${kind}:${normalized}`
  const cached = placeholderByKey.get(cacheKey)
  if (cached) return cached

  const hash = hashString(normalized)
  const palette = PLACEHOLDER_PALETTES[hash % PLACEHOLDER_PALETTES.length]
  const icon = resolvePlaceholderIcon(kind)
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64" fill="none">
      <rect x="2" y="2" width="60" height="60" rx="30" fill="${palette.bg}"/>
      <rect x="2" y="2" width="60" height="60" rx="30" stroke="${palette.ring}" stroke-width="2.5"/>
      ${getPlaceholderIconMarkup(icon, palette.icon)}
    </svg>
  `.trim()
  const encoded = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
  placeholderByKey.set(cacheKey, encoded)
  return encoded
}

const logoByKey = new Map<string, string>()

for (const entry of bundledWalletLogos) {
  for (const name of entry.names) {
    for (const key of variantsOf(name)) {
      if (!logoByKey.has(key)) logoByKey.set(key, entry.src)
    }
  }
}

export function findBundledTokenLogoForAsset(assetName: string): string | null {
  const raw = String(assetName || '').trim()
  if (!raw) return null
  const parsed = splitAssetName(raw)
  const candidates = [raw, parsed.sub || '', parsed.root]
  for (const candidate of candidates) {
    for (const key of variantsOf(candidate)) {
      const match = logoByKey.get(key)
      if (match) return match
    }
  }
  return null
}

export function getUnifiedLogoByName(name: string): string {
  const raw = String(name || '').trim()
  if (!raw) return createSystemPlaceholderLogo('network', 'coin')
  for (const key of variantsOf(raw)) {
    const match = logoByKey.get(key)
    if (match) return match
  }
  return createSystemPlaceholderLogo(raw, 'coin')
}

export function getTokenLogoForAsset(assetName: string): string {
  return findBundledTokenLogoForAsset(assetName) || createSystemPlaceholderLogo(assetName, 'token')
}
