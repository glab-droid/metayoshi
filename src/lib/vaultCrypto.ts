export type EncryptedVaultV1 = {
  v: 1
  kdf: 'PBKDF2'
  hash: 'SHA-256'
  iterations: number
  saltB64: string
  alg: 'AES-GCM'
  ivB64: string
  ctB64: string
}

export type VaultPlainV1 = {
  v: 1
  mnemonic: string
  createdAt: number
}

function bytesToB64(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i])
  return btoa(bin)
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i)
  return out
}

async function deriveKey(params: { password: string; salt: Uint8Array; iterations: number }): Promise<CryptoKey> {
  const enc = new TextEncoder()
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(params.password), 'PBKDF2', false, ['deriveKey'])
  // TS/DOM lib types sometimes widen Uint8Array.buffer to ArrayBufferLike; copy to ensure ArrayBuffer-backed view.
  const salt = new Uint8Array(params.salt)
  return await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: params.iterations, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  )
}

export async function encryptVaultV1(params: { password: string; mnemonic: string }): Promise<EncryptedVaultV1> {
  const iterations = 310_000
  const salt = new Uint8Array(crypto.getRandomValues(new Uint8Array(16)))
  const iv = new Uint8Array(crypto.getRandomValues(new Uint8Array(12)))
  const key = await deriveKey({ password: params.password, salt, iterations })

  const plain: VaultPlainV1 = { v: 1, mnemonic: params.mnemonic.trim(), createdAt: Date.now() }
  const encoded = new TextEncoder().encode(JSON.stringify(plain))

  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded))
  return {
    v: 1,
    kdf: 'PBKDF2',
    hash: 'SHA-256',
    iterations,
    saltB64: bytesToB64(salt),
    alg: 'AES-GCM',
    ivB64: bytesToB64(iv),
    ctB64: bytesToB64(ct)
  }
}

export async function decryptVaultV1(params: { password: string; vault: EncryptedVaultV1 }): Promise<VaultPlainV1> {
  if (params.vault.v !== 1) throw new Error('Unsupported vault version')
  const salt = new Uint8Array(b64ToBytes(params.vault.saltB64))
  const iv = new Uint8Array(b64ToBytes(params.vault.ivB64))
  const ct = new Uint8Array(b64ToBytes(params.vault.ctB64))
  const key = await deriveKey({ password: params.password, salt, iterations: params.vault.iterations })

  const pt = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct))
  const text = new TextDecoder().decode(pt)
  const parsed = JSON.parse(text) as VaultPlainV1
  if (!parsed?.mnemonic || parsed.v !== 1) throw new Error('Invalid vault data')
  return parsed
}

