export type ThemeMode = 'dark' | 'light'

const STORAGE_KEY = 'metayoshi.theme.mode'

function normalizeThemeMode(value: unknown): ThemeMode {
  return String(value || '').trim().toLowerCase() === 'dark' ? 'dark' : 'light'
}

export function getStoredThemeMode(): ThemeMode {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    return normalizeThemeMode(raw)
  } catch {
    return 'light'
  }
}

export function applyThemeMode(mode: ThemeMode): void {
  if (typeof document === 'undefined') return
  const next = normalizeThemeMode(mode)
  const root = document.documentElement
  root.classList.remove('theme-dark', 'theme-light')
  root.classList.add(`theme-${next}`)
  root.setAttribute('data-theme', next)
  root.style.colorScheme = next
}

export function setThemeMode(mode: ThemeMode): ThemeMode {
  const next = normalizeThemeMode(mode)
  try {
    window.localStorage.setItem(STORAGE_KEY, next)
  } catch {
    // best effort only
  }
  applyThemeMode(next)
  return next
}

export function initThemeMode(): ThemeMode {
  const current = getStoredThemeMode()
  applyThemeMode(current)
  return current
}
