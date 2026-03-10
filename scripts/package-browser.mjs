import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'

function parseCsvList(value) {
  return String(value || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
}

const target = String(process.argv[2] || '').trim().toLowerCase()
if (!target || !['chromium', 'chrome', 'brave', 'firefox'].includes(target)) {
  console.error('Usage: node scripts/package-browser.mjs <chromium|chrome|brave|firefox>')
  process.exit(1)
}

const root = process.cwd()
const srcDist = path.join(root, 'dist')
if (!existsSync(srcDist)) {
  console.error('dist/ not found. Run npm run build first.')
  process.exit(1)
}

const outDirNameMap = {
  chromium: 'dist-chromium',
  chrome: 'dist-chrome',
  brave: 'dist-brave',
  firefox: 'dist-firefox'
}
const outDir = path.join(root, outDirNameMap[target])
rmSync(outDir, { recursive: true, force: true })
mkdirSync(outDir, { recursive: true })
cpSync(srcDist, outDir, { recursive: true })

const baseManifestPath = path.join(root, 'public', 'manifest.json')
const manifest = JSON.parse(readFileSync(baseManifestPath, 'utf-8'))

if (target !== 'firefox') {
  // Firefox-only metadata should never appear in Chromium packages.
  delete manifest.browser_specific_settings
}

if (target === 'firefox') {
  const requiredPermissions = parseCsvList(process.env.FIREFOX_DATA_COLLECTION_REQUIRED)
  const optionalPermissions = parseCsvList(process.env.FIREFOX_DATA_COLLECTION_OPTIONAL)
  const normalizedRequired = requiredPermissions.includes('none') && requiredPermissions.length > 1
    ? requiredPermissions.filter((permission) => permission !== 'none')
    : requiredPermissions

  // Firefox-specific metadata for AMO/self-hosted signing.
  manifest.browser_specific_settings = {
    gecko: {
      id: process.env.FIREFOX_EXTENSION_ID || 'metayoshi@metayoshi.app',
      strict_min_version: process.env.FIREFOX_MIN_VERSION || '142.0',
      data_collection_permissions: {
        required: normalizedRequired.length > 0 ? normalizedRequired : ['none'],
        optional: optionalPermissions
      }
    }
  }

  // Chromium-only key; keep Firefox manifest clean.
  delete manifest.externally_connectable

  // Some Firefox channels/configurations still reject MV3 service workers
  // for temporary add-on installs. Fall back to background.scripts.
  if (manifest.background?.service_worker) {
    manifest.background = {
      scripts: [manifest.background.service_worker],
      type: manifest.background.type
    }
  }
}

const outManifestPath = path.join(outDir, 'manifest.json')
writeFileSync(outManifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf-8')

console.log(`Packed ${target} build -> ${path.relative(root, outDir)}`)
