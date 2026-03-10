import React from 'react'
import ReactDOM from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import App from './App'
import './styles/index.css'
import { installGlobalErrorMonitor, recordRuntimeError } from './lib/runtimeErrorMonitor'
import { initThemeMode } from './lib/themeMode'

import { ToastProvider } from './components/Toast'

function installZoomShortcutBlockers(): void {
  const blockZoomKeyCombo = (event: KeyboardEvent): boolean => {
    if (!event.ctrlKey && !event.metaKey) return false
    const key = String(event.key || '').toLowerCase()
    return key === '+' || key === '=' || key === '-' || key === '_' || key === '0'
  }

  // Prevent trackpad pinch and Ctrl/Meta + wheel zoom.
  window.addEventListener(
    'wheel',
    (event) => {
      if (!event.ctrlKey && !event.metaKey) return
      event.preventDefault()
    },
    { passive: false, capture: true }
  )

  // Prevent keyboard zoom shortcuts (Ctrl/Meta + +, -, 0).
  window.addEventListener(
    'keydown',
    (event) => {
      if (!blockZoomKeyCombo(event)) return
      event.preventDefault()
    },
    { capture: true }
  )

  // Safari/WebKit gesture pinch events.
  const preventGestureZoom = (event: Event) => event.preventDefault()
  document.addEventListener('gesturestart', preventGestureZoom as EventListener, { passive: false })
  document.addEventListener('gesturechange', preventGestureZoom as EventListener, { passive: false })
  document.addEventListener('gestureend', preventGestureZoom as EventListener, { passive: false })
}

function shouldBlockZoomShortcuts(): boolean {
  const raw = String((import.meta as any)?.env?.VITE_BLOCK_ZOOM_SHORTCUTS || '').trim().toLowerCase()
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on'
}

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; error?: Error }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('React Error Boundary caught an error:', error, errorInfo)
    void recordRuntimeError('popup-ui', error, {
      kind: 'react-error-boundary',
      componentStack: errorInfo.componentStack
    })
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            padding: '20px',
            color: 'white',
            backgroundColor: '#0b0c0e',
            minHeight: '100vh',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center'
          }}
        >
          <h1>Something went wrong</h1>
          <p>{this.state.error?.message || 'Unknown error'}</p>
          <button onClick={() => window.location.reload()}>Reload</button>
        </div>
      )
    }

    return this.props.children
  }
}

installGlobalErrorMonitor('popup-ui')
installZoomShortcutBlockers()
initThemeMode()

const rootElement = document.getElementById('app')
if (!rootElement) {
  console.error('App element not found!')
  throw new Error('App element not found')
}

try {
  const root = ReactDOM.createRoot(rootElement)

  root.render(
    <React.StrictMode>
      <ErrorBoundary>
        <HashRouter>
          <ToastProvider>
            <App />
          </ToastProvider>
        </HashRouter>
      </ErrorBoundary>
    </React.StrictMode>
  )
} catch (error) {
  console.error('Failed to render React app:', error)
  void recordRuntimeError('popup-ui', error, { kind: 'bootstrap-render' })
  rootElement.replaceChildren()

  const wrapper = document.createElement('div')
  wrapper.style.padding = '20px'
  wrapper.style.color = 'white'
  wrapper.style.backgroundColor = '#0b0c0e'
  wrapper.style.minHeight = '100vh'

  const title = document.createElement('h1')
  title.textContent = 'Failed to load application'

  const message = document.createElement('p')
  message.textContent = error instanceof Error ? error.message : 'Unknown error'

  const details = document.createElement('pre')
  details.style.background = '#1a1a1a'
  details.style.padding = '10px'
  details.style.overflow = 'auto'
  details.textContent = error instanceof Error ? (error.stack || error.message) : String(error)

  const reloadButton = document.createElement('button')
  reloadButton.type = 'button'
  reloadButton.textContent = 'Reload'
  reloadButton.style.marginTop = '10px'
  reloadButton.style.padding = '10px 20px'
  reloadButton.style.background = '#f97316'
  reloadButton.style.color = 'white'
  reloadButton.style.border = 'none'
  reloadButton.style.borderRadius = '5px'
  reloadButton.style.cursor = 'pointer'
  reloadButton.addEventListener('click', () => window.location.reload())

  wrapper.append(title, message, details, reloadButton)
  rootElement.appendChild(wrapper)
}
