export interface BalanceSnapshotLike {
  balance: string
  syncPercent: number | null
  isSyncing: boolean
}

type AccountWithNetworkBalances = {
  id: string
  balance: string
  networkBalances?: Record<string, string>
}

export function updateAccountsWithNetworkBalance<T extends AccountWithNetworkBalances>(
  accounts: T[],
  accountId: string,
  networkId: string,
  balance: string
): T[] {
  return accounts.map((account) => (
    account.id === accountId
      ? {
          ...account,
          balance,
          networkBalances: {
            ...(account.networkBalances ?? {}),
            [networkId]: balance
          }
        }
      : account
  ))
}

export function computeLowSyncStreak(
  previousLowSyncStreak: number,
  snapshot: Pick<BalanceSnapshotLike, 'syncPercent' | 'isSyncing'>,
  minimumSyncPercentForSend: number
): number {
  const syncPercentIsLow =
    typeof snapshot.syncPercent === 'number'
    && Number.isFinite(snapshot.syncPercent)
    && snapshot.syncPercent < minimumSyncPercentForSend
  const lowSyncCheck = snapshot.isSyncing || syncPercentIsLow
  return lowSyncCheck ? Math.min(50, (previousLowSyncStreak || 0) + 1) : 0
}
