import { useEffect, useState } from 'react'
import {
  DAPP_PENDING_APPROVAL_STORAGE_KEY,
  parseDappPendingApproval,
  type DappPendingApproval
} from '../../lib/dappPermissions'

export function canUseChromeStorage(): boolean {
  return typeof chrome !== 'undefined' && Boolean(chrome.storage?.local)
}

export function usePendingDappApproval() {
  const [pendingApproval, setPendingApproval] = useState<DappPendingApproval | null>(null)
  const [loadingApproval, setLoadingApproval] = useState(true)

  useEffect(() => {
    if (!canUseChromeStorage()) {
      setLoadingApproval(false)
      return
    }

    let mounted = true

    const applyPendingValue = (rawValue: unknown): void => {
      const parsed = parseDappPendingApproval(rawValue)
      if (!mounted) return
      setPendingApproval(parsed && parsed.status === 'pending' ? parsed : null)
      setLoadingApproval(false)
    }

    void chrome.storage.local
      .get(DAPP_PENDING_APPROVAL_STORAGE_KEY)
      .then((result) => {
        applyPendingValue(result[DAPP_PENDING_APPROVAL_STORAGE_KEY])
      })
      .catch(() => {
        if (!mounted) return
        setPendingApproval(null)
        setLoadingApproval(false)
      })

    const onStorageChanged = (
      changes: { [key: string]: chrome.storage.StorageChange },
      areaName: string
    ): void => {
      if (areaName !== 'local' || !changes[DAPP_PENDING_APPROVAL_STORAGE_KEY]) return
      applyPendingValue(changes[DAPP_PENDING_APPROVAL_STORAGE_KEY].newValue)
    }

    chrome.storage.onChanged.addListener(onStorageChanged)
    return () => {
      mounted = false
      chrome.storage.onChanged.removeListener(onStorageChanged)
    }
  }, [])

  return {
    pendingApproval,
    loadingApproval
  }
}

