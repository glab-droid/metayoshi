import { execFileSync } from 'node:child_process'
import { existsSync, rmSync } from 'node:fs'
import path from 'node:path'

const target = String(process.argv[2] || '').trim().toLowerCase()
if (!target || !['chrome', 'brave', 'firefox', 'chromium'].includes(target)) {
  console.error('Usage: node scripts/zip-browser.mjs <chrome|brave|firefox|chromium>')
  process.exit(1)
}
const customOutputName = String(process.argv[3] || '').trim()

const root = process.cwd()
const sourceDirMap = {
  chrome: 'dist-chrome',
  brave: 'dist-brave',
  firefox: 'dist-firefox',
  chromium: 'dist-chromium'
}
const sourceDir = path.join(root, sourceDirMap[target])
const outputZip = path.join(root, customOutputName || `Metayoshi-${target}.zip`)

if (!existsSync(sourceDir)) {
  console.error(`${path.basename(sourceDir)}/ not found. Run npm run build:${target} first.`)
  process.exit(1)
}

rmSync(outputZip, { force: true })

if (process.platform === 'win32') {
  const psSourceDir = sourceDir.replace(/'/g, "''")
  const psOutputZip = outputZip.replace(/'/g, "''")
  execFileSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-Command',
      `$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.IO.Compression; Add-Type -AssemblyName System.IO.Compression.FileSystem; `
      + `$source='${psSourceDir}'; $dest='${psOutputZip}'; `
      + `if (Test-Path $dest) { Remove-Item -Force $dest }; `
      + `$zip=[System.IO.Compression.ZipFile]::Open($dest,[System.IO.Compression.ZipArchiveMode]::Create); `
      + `try { `
      + `Get-ChildItem -Path $source -Recurse -File | ForEach-Object { `
      + `$relative=$_.FullName.Substring($source.Length).TrimStart('\\'); `
      + `$entryName=$relative -replace '\\\\','/'; `
      + `[System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip,$_.FullName,$entryName,[System.IO.Compression.CompressionLevel]::Optimal) | Out-Null `
      + `} `
      + `} finally { $zip.Dispose() }`
    ],
    { cwd: sourceDir, stdio: 'inherit' }
  )
} else {
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
}

console.log(`Created ${path.relative(root, outputZip)} from ${path.relative(root, sourceDir)}/`)
