import fs from 'node:fs'
import path from 'node:path'

function parseEnvFile(filePath) {
  const out = {}
  if (!fs.existsSync(filePath)) return out
  const raw = fs.readFileSync(filePath, 'utf8')
  for (const line of raw.split(/\r?\n/)) {
    const text = String(line || '').trim()
    if (!text || text.startsWith('#')) continue
    const idx = text.indexOf('=')
    if (idx < 1) continue
    const key = text.slice(0, idx).trim()
    const value = text.slice(idx + 1).trim()
    out[key] = value
  }
  return out
}

const envPath = path.resolve(process.cwd(), '.env.local')
const env = parseEnvFile(envPath)
const apiBase = String(env.VITE_API_BASE_URL || '').trim().replace(/\/+$/, '')
const bridgeUser = String(env.VITE_BRIDGE_USER || '').trim()
const bridgePass = String(env.VITE_BRIDGE_PASSWORD || '').trim()

if (!apiBase) {
  console.error('Missing VITE_API_BASE_URL in .env.local')
  process.exit(1)
}
if (!bridgeUser || !bridgePass) {
  console.error('Missing VITE_BRIDGE_USER / VITE_BRIDGE_PASSWORD in .env.local')
  process.exit(1)
}

const authHeader = `Basic ${Buffer.from(`${bridgeUser}:${bridgePass}`).toString('base64')}`
const commonHeaders = {
  'Content-Type': 'application/json',
  'Authorization': authHeader
}

const results = []

async function runHttpTest(name, url, options, validate) {
  const startedAt = Date.now()
  try {
    const res = await fetch(url, options)
    const raw = await res.text()
    const data = raw ? (() => {
      try { return JSON.parse(raw) } catch { return raw }
    })() : null
    let ok = res.ok
    let detail = ''
    if (validate) {
      const validated = validate(data, res)
      if (validated !== true) {
        ok = false
        detail = String(validated || 'validation failed')
      }
    }
    results.push({
      name,
      ok,
      status: res.status,
      ms: Date.now() - startedAt,
      detail,
      sample: data
    })
  } catch (error) {
    results.push({
      name,
      ok: false,
      status: null,
      ms: Date.now() - startedAt,
      detail: error instanceof Error ? error.message : String(error),
      sample: null
    })
  }
}

async function runRpcTest(coin, method, params, validateResult) {
  const url = `${apiBase}/v1/bridge/${coin}/main`
  const body = { jsonrpc: '1.0', id: 'smoke', method, params }
  await runHttpTest(`${coin}:${method}`, url, {
    method: 'POST',
    headers: commonHeaders,
    body: JSON.stringify(body)
  }, (data, res) => {
    if (!res.ok) {
      const rpcMessage = String(data?.error?.message || data?.error || '').trim()
      return rpcMessage ? `HTTP ${res.status} (${rpcMessage})` : `HTTP ${res.status}`
    }
    if (!data || typeof data !== 'object') return 'response is not an object'
    if (data.error) return `rpc error: ${JSON.stringify(data.error)}`
    if (!Object.prototype.hasOwnProperty.call(data, 'result')) return 'missing result field'
    return validateResult ? validateResult(data.result) : true
  })
}

function isHexQuantity(value) {
  return /^0x[0-9a-f]+$/i.test(String(value || ''))
}

function parseHexQuantity(value) {
  if (!isHexQuantity(value)) return null
  try {
    return Number.parseInt(String(value), 16)
  } catch {
    return null
  }
}

async function main() {
  const zeroAddress = '0x0000000000000000000000000000000000000000'

  // Endpoint health + method catalog.
  await runHttpTest('health', `${apiBase}/health`, { method: 'GET' }, (_data, res) => (
    res.ok ? true : `HTTP ${res.status}`
  ))

  await runHttpTest('methods:firo', `${apiBase}/v1/bridge/methods/firo`, {
    method: 'GET',
    headers: commonHeaders
  }, (data, res) => {
    if (!res.ok) return `HTTP ${res.status}`
    const methods = Array.isArray(data?.result?.methods) ? data.result.methods : []
    if (methods.length === 0) return 'missing result.methods'
    if (methods.includes('getinfo')) return 'unexpected legacy getinfo in FIRO methods'
    return true
  })

  await runHttpTest('methods:ethereum', `${apiBase}/v1/bridge/methods/ethereum`, {
    method: 'GET',
    headers: commonHeaders
  }, (data, res) => {
    if (!res.ok) return `HTTP ${res.status}`
    const methods = Array.isArray(data?.result?.methods) ? data.result.methods : []
    return methods.length > 0 ? true : 'missing result.methods'
  })

  await runHttpTest('methods:base', `${apiBase}/v1/bridge/methods/base`, {
    method: 'GET',
    headers: commonHeaders
  }, (data, res) => {
    if (!res.ok) return `HTTP ${res.status}`
    const methods = Array.isArray(data?.result?.methods) ? data.result.methods : []
    return methods.length > 0 ? true : 'missing result.methods'
  })

  // FIRO expectations: no getinfo calls; use supported methods only.
  await runRpcTest('firo', 'getblockchaininfo', [], (result) => {
    if (!result || typeof result !== 'object') return 'result not object'
    if (typeof result.chain !== 'string') return 'missing chain'
    if (typeof result.blocks !== 'number') return 'missing blocks'
    return true
  })
  await runRpcTest('firo', 'getwalletinfo', [], (result) => (
    result && typeof result === 'object' ? true : 'result not object'
  ))
  await runRpcTest('firo', 'validateaddress', ['aPkbNkmpaWieJ22xdeaUh7vJnPT5stjJjC'], (result) => (
    typeof result?.isvalid === 'boolean' ? true : 'missing isvalid'
  ))

  // ETH core read methods used by app runtime.
  await runRpcTest('ethereum', 'eth_chainId', [], (result) => (
    isHexQuantity(result) ? true : 'invalid eth_chainId'
  ))
  await runRpcTest('ethereum', 'eth_blockNumber', [], (result) => (
    isHexQuantity(result) ? true : 'invalid eth_blockNumber'
  ))
  await runRpcTest('ethereum', 'eth_gasPrice', [], (result) => (
    isHexQuantity(result) ? true : 'invalid eth_gasPrice'
  ))
  await runRpcTest('ethereum', 'eth_getBalance', [zeroAddress, 'latest'], (result) => (
    isHexQuantity(result) ? true : 'invalid eth_getBalance'
  ))
  await runRpcTest('ethereum', 'eth_getTransactionCount', [zeroAddress, 'latest'], (result) => (
    isHexQuantity(result) ? true : 'invalid eth_getTransactionCount'
  ))

  // Base core read methods used by app runtime.
  await runRpcTest('base', 'eth_chainId', [], (result) => {
    if (!isHexQuantity(result)) return 'invalid base eth_chainId'
    const chainId = parseHexQuantity(result)
    return chainId === 8453 ? true : `unexpected chainId ${String(result)}`
  })
  await runRpcTest('base', 'eth_blockNumber', [], (result) => (
    isHexQuantity(result) ? true : 'invalid base eth_blockNumber'
  ))
  await runRpcTest('base', 'eth_gasPrice', [], (result) => (
    isHexQuantity(result) ? true : 'invalid base eth_gasPrice'
  ))
  await runRpcTest('base', 'eth_getBalance', [zeroAddress, 'latest'], (result) => (
    isHexQuantity(result) ? true : 'invalid base eth_getBalance'
  ))
  await runRpcTest('base', 'eth_getTransactionCount', [zeroAddress, 'latest'], (result) => (
    isHexQuantity(result) ? true : 'invalid base eth_getTransactionCount'
  ))

  const total = results.length
  const passed = results.filter((r) => r.ok).length
  const failed = total - passed

  console.log(`API smoke test (${new Date().toISOString()})`)
  console.log(`Base: ${apiBase}`)
  console.log(`Total: ${total} | Passed: ${passed} | Failed: ${failed}`)
  console.log('')
  for (const row of results) {
    const statusText = row.status === null ? 'ERR' : String(row.status)
    const marker = row.ok ? 'PASS' : 'FAIL'
    const note = row.detail ? ` | ${row.detail}` : ''
    console.log(`${marker} | ${statusText} | ${row.name}${note}`)
  }

  if (failed > 0) process.exit(2)
}

void main()
