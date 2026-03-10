export const MIN_SYNC_PERCENT_FOR_SEND = 99
export const MIN_LOW_SYNC_CHECKS_BEFORE_BLOCK = 3

function isFinitePercent(value: number | null): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

export function isSendBlockedBySync(
  syncing: boolean,
  syncPercent: number | null,
  connected = false,
  lowSyncStreak = 0
): boolean {
  // Keep send actions available during temporary "waiting/syncing" windows
  // once the wallet already has a good connection.
  if (connected && syncing && !isFinitePercent(syncPercent)) return false

  const syncPercentIsLow = isFinitePercent(syncPercent) && syncPercent < MIN_SYNC_PERCENT_FOR_SEND
  const lowNow = syncing || syncPercentIsLow
  if (!lowNow) return false

  return Number(lowSyncStreak) >= MIN_LOW_SYNC_CHECKS_BEFORE_BLOCK
}

export function getSendBlockedSyncReason(
  syncing: boolean,
  syncPercent: number | null,
  connected = false,
  lowSyncStreak = 0
): string {
  if (!isSendBlockedBySync(syncing, syncPercent, connected, lowSyncStreak)) return ''
  if (isFinitePercent(syncPercent)) {
    return `Network sync is ${syncPercent.toFixed(1)}%. Wait until at least ${MIN_SYNC_PERCENT_FOR_SEND.toFixed(2)}% to send.`
  }
  if (syncing) {
    return 'Network is still syncing. Wait until sync completes to send.'
  }
  return 'Network sync is too low to send right now.'
}
