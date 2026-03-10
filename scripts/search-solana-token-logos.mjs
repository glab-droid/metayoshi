import fs from 'node:fs'
import path from 'node:path'

const FALLBACK_URLS = [
  'https://token.jup.ag/all',
  'https://raw.githubusercontent.com/solana-labs/token-list/main/src/tokens/solana.tokenlist.json',
  'https://cdn.jsdelivr.net/gh/solana-labs/token-list@main/src/tokens/solana.tokenlist.json'
]

function parseEnvFile(filePath) {
  const out = {}
  if (!fs.existsSync(filePath)) return out
  const raw = fs.readFileSync(filePath, 'utf8')
  for (const line of raw.split(/\r?\n/)) {
    const text = String(line || '').trim()
    if (!text || text.startsWith('#')) continue
    const idx = text.indexOf('=')
    if (idx < 1) continue
    out[text.slice(0, idx).trim()] = text.slice(idx + 1).trim()
  }
  return out
}

function normalizeText(value) {
  return String(value || '').trim()
}

function extractRows(json) {
  if (Array.isArray(json)) return json
  if (json && typeof json === 'object' && Array.isArray(json.tokens)) return json.tokens
  return []
}

async function fetchRows(url) {
  const res = await fetch(url, { method: 'GET' })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const json = await res.json()
  return extractRows(json)
}

async function loadRegistryRows(preferredUrl) {
  const urls = preferredUrl
    ? [preferredUrl, ...FALLBACK_URLS.filter((u) => u !== preferredUrl)]
    : FALLBACK_URLS

  let lastError = null
  for (const url of urls) {
    try {
      const rows = await fetchRows(url)
      if (rows.length > 0) return { rows, source: url }
    } catch (error) {
      lastError = error
    }
  }
  throw lastError || new Error('Unable to fetch Solana token list from configured sources')
}

function buildRecord(row) {
  const mint = normalizeText(row?.address || row?.mint)
  const symbol = normalizeText(row?.symbol).toUpperCase()
  const name = normalizeText(row?.name)
  const decimals = Number(row?.decimals ?? 0)
  const logoURI = normalizeText(row?.logoURI || row?.logoUri)
  if (!mint) return null
  return {
    mint,
    symbol: symbol || name || mint.slice(0, 8),
    name: name || symbol || mint.slice(0, 8),
    decimals: Number.isFinite(decimals) ? Math.max(0, Math.trunc(decimals)) : 0,
    logoURI
  }
}

function matchRecord(record, query) {
  const q = normalizeText(query).toLowerCase()
  if (!q) return true
  return (
    record.mint.toLowerCase() === q
    || record.mint.toLowerCase().includes(q)
    || record.symbol.toLowerCase().includes(q)
    || record.name.toLowerCase().includes(q)
  )
}

function parseArgs(argv) {
  const out = { json: false, limit: 50, query: '' }
  const rest = []
  for (let i = 0; i < argv.length; i += 1) {
    const token = String(argv[i] || '').trim()
    if (!token) continue
    if (token === '--json') {
      out.json = true
      continue
    }
    if (token.startsWith('--limit=')) {
      const n = Number(token.slice('--limit='.length))
      if (Number.isFinite(n) && n > 0) out.limit = Math.max(1, Math.trunc(n))
      continue
    }
    rest.push(token)
  }
  out.query = rest.join(' ').trim()
  return out
}

function printUsage() {
  console.log('Usage: node scripts/search-solana-token-logos.mjs <mint|symbol|name> [--limit=50] [--json]')
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (!args.query) {
    printUsage()
    process.exit(1)
  }

  const envPath = path.resolve(process.cwd(), '.env.local')
  const env = parseEnvFile(envPath)
  const configuredUrl = normalizeText(env.VITE_SOL_TOKEN_REGISTRY_URL)
  const { rows, source } = await loadRegistryRows(configuredUrl)

  const byMint = new Map()
  for (const row of rows) {
    const record = buildRecord(row)
    if (!record) continue
    if (!matchRecord(record, args.query)) continue
    const existing = byMint.get(record.mint)
    if (!existing) {
      byMint.set(record.mint, record)
      continue
    }
    const existingHasLogo = Boolean(existing.logoURI)
    const nextHasLogo = Boolean(record.logoURI)
    if (!existingHasLogo && nextHasLogo) byMint.set(record.mint, record)
  }

  const matches = [...byMint.values()]
    .sort((a, b) => a.symbol.localeCompare(b.symbol) || a.name.localeCompare(b.name))
    .slice(0, args.limit)

  if (args.json) {
    console.log(JSON.stringify({ source, query: args.query, total: matches.length, results: matches }, null, 2))
    return
  }

  console.log(`Source: ${source}`)
  console.log(`Query: ${args.query}`)
  console.log(`Matches: ${matches.length}`)
  console.log('')
  for (const row of matches) {
    console.log(`${row.symbol} | ${row.name}`)
    console.log(`  mint: ${row.mint}`)
    console.log(`  decimals: ${row.decimals}`)
    console.log(`  logoURI: ${row.logoURI || '(missing)'}`)
  }
}

void main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`Search failed: ${message}`)
  process.exit(2)
})
