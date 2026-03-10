import { execFileSync } from 'node:child_process'
import { existsSync, rmSync } from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const sourceDir = path.join(root, 'dist-chromium')
const outputZip = path.join(root, 'Metayoshi-chromium.zip')

if (!existsSync(sourceDir)) {
  console.error('dist-chromium/ not found. Run npm run build:chromium first.')
  process.exit(1)
}

rmSync(outputZip, { force: true })

// Build zip from inside dist-chromium so manifest.json is at archive root.
execFileSync(
  'zip',
  [
    '-r',
    '-X',
    outputZip,
    '.',
    '-x', '**/.DS_Store',
    '-x', '**/__MACOSX/*',
    '-x', '**/._*'
  ],
  { cwd: sourceDir, stdio: 'inherit' }
)

console.log(`Created ${path.relative(root, outputZip)} from ${path.relative(root, sourceDir)}/`)
