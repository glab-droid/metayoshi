type BridgeCredentialLike = {
  bridgeUrl?: string
  bridgeUsername?: string
  bridgePassword?: string
  name?: string
}

type BridgeCredentialEnvOptions = {
  userEnvKey?: string
  passEnvKey?: string
  label?: string
}

export function normalizeBridgeCredentialValue(value: unknown): string | undefined {
  const normalized = String(value ?? '').trim()
  return normalized || undefined
}

export function readBridgeCredentialsFromEnv(
  env: Record<string, unknown>,
  options: BridgeCredentialEnvOptions = {}
): {
  bridgeUsername?: string
  bridgePassword?: string
} {
  const userEnvKey = String(options.userEnvKey || 'VITE_BRIDGE_USER').trim() || 'VITE_BRIDGE_USER'
  const passEnvKey = String(options.passEnvKey || 'VITE_BRIDGE_PASSWORD').trim() || 'VITE_BRIDGE_PASSWORD'
  const label = String(options.label || 'bridge').trim() || 'bridge'

  const bridgeUsername = normalizeBridgeCredentialValue(env[userEnvKey])
  const bridgePassword = normalizeBridgeCredentialValue(env[passEnvKey])

  if ((bridgeUsername && !bridgePassword) || (!bridgeUsername && bridgePassword)) {
    throw new Error(
      `Bridge credentials are partially configured for ${label}. ` +
      `Set both ${userEnvKey} and ${passEnvKey}, or leave both unset.`
    )
  }

  return { bridgeUsername, bridgePassword }
}

export function getMissingBridgeCredentialsMessage(input: BridgeCredentialLike): string | null {
  const bridgeUrl = String(input.bridgeUrl || '').trim()
  if (!bridgeUrl) return null

  const bridgeUsername = normalizeBridgeCredentialValue(input.bridgeUsername)
  const bridgePassword = normalizeBridgeCredentialValue(input.bridgePassword)
  if (bridgeUsername && bridgePassword) return null

  const label = String(input.name || bridgeUrl).trim() || 'this network'
  return (
    `Bridge credentials are not configured for ${label}. ` +
    'Set the bridge username and password in environment or server registry config.'
  )
}

export function assertBridgeCredentialsConfigured(input: BridgeCredentialLike): void {
  const message = getMissingBridgeCredentialsMessage(input)
  if (message) throw new Error(message)
}
