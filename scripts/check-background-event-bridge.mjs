import fs from 'node:fs'
import path from 'node:path'

const repoRoot = process.cwd()
const targetPath = path.join(repoRoot, 'src', 'background', 'service-worker.ts')
const source = fs.readFileSync(targetPath, 'utf8')

function fail(message) {
  console.error(`[background-event-bridge] ${message}`)
  process.exit(1)
}

function extractBlock(startNeedle) {
  const start = source.indexOf(startNeedle)
  if (start === -1) return null
  const braceStart = source.indexOf('{', start)
  if (braceStart === -1) return null

  let depth = 0
  for (let i = braceStart; i < source.length; i += 1) {
    const char = source[i]
    if (char === '{') depth += 1
    if (char === '}') depth -= 1
    if (depth === 0) {
      return source.slice(start, i + 1)
    }
  }
  return null
}

if (!source.includes('function handleWalletStorageBroadcast(')) {
  fail('missing singleton wallet storage broadcast handler')
}

if (!source.includes('chrome.storage.onChanged.addListener(handleWalletStorageBroadcast)')) {
  fail('missing singleton chrome.storage.onChanged registration')
}

const onConnectBlock = extractBlock('chrome.runtime.onConnect.addListener(')
if (!onConnectBlock) {
  fail('could not locate chrome.runtime.onConnect handler')
}

if (onConnectBlock.includes('chrome.storage.onChanged.addListener(')) {
  fail('chrome.storage.onChanged listener is still being registered inside onConnect')
}

const broadcastBlock = extractBlock('function broadcastEvent(')
if (!broadcastBlock) {
  fail('could not locate broadcastEvent function')
}

if (!broadcastBlock.includes('if (eventPorts.size === 0) return')) {
  fail('broadcastEvent is missing the empty-port guard')
}

console.log('[background-event-bridge] singleton listener guard checks passed')
