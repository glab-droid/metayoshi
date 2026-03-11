import type { UtxoRpcConfig } from './utxoRpc'
import { callBridgeMethod } from './utxoRpc'

export interface XrpAccountBalance {
  exists: boolean
  balance: string
}

function formatDropsAsXrp(dropsValue: string | number | bigint): string {
  const drops = BigInt(String(dropsValue || '0'))
  const sign = drops < 0n ? '-' : ''
  const abs = drops < 0n ? -drops : drops
  const whole = abs / 1_000_000n
  const frac = abs % 1_000_000n
  if (frac === 0n) return `${sign}${whole.toString()}`
  const fracText = frac.toString().padStart(6, '0').replace(/0+$/, '')
  return `${sign}${whole.toString()}.${fracText}`
}

function isMissingAccountError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '')
  return /actnotfound|account not found|unknown account|noAccount/i.test(message)
}

function resolveAccountInfoPayload(raw: any): any {
  if (raw?.account_data) return raw
  if (raw?.result?.account_data) return raw.result
  if (raw?.result?.result?.account_data) return raw.result.result
  return raw
}

export async function getXrpAccountBalance(
  config: UtxoRpcConfig,
  address: string
): Promise<XrpAccountBalance> {
  const normalizedAddress = String(address || '').trim()
  if (!normalizedAddress) throw new Error('XRP address is required')

  try {
    const raw = await callBridgeMethod(config, 'account_info', [{
      account: normalizedAddress,
      ledger_index: 'validated',
      strict: true,
      queue: true
    }])

    const payload = resolveAccountInfoPayload(raw)
    const accountData = payload?.account_data
    const drops = accountData?.Balance
    if (drops === undefined || drops === null) {
      throw new Error('account_info response did not include account_data.Balance')
    }
    return { exists: true, balance: formatDropsAsXrp(drops) }
  } catch (error) {
    if (isMissingAccountError(error)) {
      return { exists: false, balance: '0' }
    }
    throw error
  }
}
