import React, { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { IoArrowBackOutline, IoDocumentOutline, IoOpenOutline, IoRefreshOutline } from 'react-icons/io5'
import { useWalletStore } from '../../store/walletStore'
import { parseSolanaAssetType } from '../../lib/assetTypes'

type PreviewKind = 'image' | 'pdf' | 'json' | 'text' | 'binary' | 'none'

function normalizePreviewValue(value: string): string {
  const v = String(value || '').trim()
  if (!v) return ''
  if (v.startsWith('ipfs://')) return v.replace(/^ipfs:\/\//i, '').replace(/^ipfs\//i, '').replace(/^\/+/, '')
  return v
}

function buildSourceUrls(value: string): string[] {
  const v = String(value || '').trim()
  if (!v) return []
  if (/^https?:\/\//i.test(v)) return [v]
  if (/^data:/i.test(v)) return [v]
  if (/^ipfs:\/\//i.test(v) || /^ipfs\//i.test(v)) {
    const cid = normalizePreviewValue(v)
    if (!cid) return []
    return [
      `https://gateway.pinata.cloud/ipfs/${cid}`,
      `https://ipfs.io/ipfs/${cid}`,
      `https://cloudflare-ipfs.com/ipfs/${cid}`
    ]
  }
  return [v]
}

function inferKind(contentType: string): PreviewKind {
  const ct = (contentType || '').toLowerCase()
  if (ct.startsWith('image/')) return 'image'
  if (ct.includes('pdf')) return 'pdf'
  if (ct.includes('json')) return 'json'
  if (ct.startsWith('text/')) return 'text'
  return 'binary'
}

const AssetPreviewPage: React.FC = () => {
  const navigate = useNavigate()
  const location = useLocation()
  const { fetchAssetDetails, networks, activeNetworkId } = useWalletStore()

  const assetId = String((location.state as { assetId?: string } | null)?.assetId || '').trim()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [assetName, setAssetName] = useState(assetId)
  const [sourceRef, setSourceRef] = useState('')
  const [contentType, setContentType] = useState('')
  const [kind, setKind] = useState<PreviewKind>('none')
  const [textContent, setTextContent] = useState('')
  const [blobUrl, setBlobUrl] = useState('')
  const [activeSourceUrl, setActiveSourceUrl] = useState('')

  const gatewayUrls = useMemo(() => buildSourceUrls(sourceRef), [sourceRef])
  const activeNetwork = networks.find((network) => network.id === activeNetworkId) || networks[0]
  const activeModelId = String(activeNetwork?.runtimeModelId || activeNetwork?.id || '').trim().toLowerCase()
  const isSolanaEcosystem = activeNetwork?.coinType === 'SOL' || activeModelId === 'sol'
  const isSolanaNftAsset = useMemo(() => {
    if (!isSolanaEcosystem) return true
    const type = parseSolanaAssetType(assetId)
    return type === 'spl-nft' || type === 'compressed-nft'
  }, [assetId, isSolanaEcosystem])

  const loadPreview = async () => {
    setLoading(true)
    setError('')
    setTextContent('')
    setContentType('')
    setKind('none')
    setSourceRef('')
    setActiveSourceUrl('')
    if (blobUrl) {
      URL.revokeObjectURL(blobUrl)
      setBlobUrl('')
    }

    if (!assetId) {
      setError('No asset selected for preview.')
      setLoading(false)
      return
    }

    try {
      const details = await fetchAssetDetails(assetId)
      setAssetName(details?.name || assetId)
      const previewRef = String(details?.preview_url || details?.ipfs_hash || details?.metadata_url || '').trim()
      setSourceRef(previewRef)
      if (!previewRef) {
        setError('No preview source metadata found for this asset.')
        setLoading(false)
        return
      }

      const urls = buildSourceUrls(previewRef)

      let loaded = false
      for (const url of urls) {
        try {
          const res = await fetch(url)
          if (!res.ok) continue
          const ct = res.headers.get('content-type') || ''
          setContentType(ct)
          setActiveSourceUrl(url)
          const detectedKind = inferKind(ct)
          setKind(detectedKind)

          if (detectedKind === 'json' || detectedKind === 'text') {
            const text = await res.text()
            setTextContent(text.slice(0, 300000))
          } else {
            const blob = await res.blob()
            const objectUrl = URL.createObjectURL(blob)
            setBlobUrl(objectUrl)
          }
          loaded = true
          break
        } catch {
          // try next gateway
        }
      }

      if (!loaded) {
        setKind('binary')
        setActiveSourceUrl(urls[0] || '')
        setError('Could not fetch preview directly. Try opening from a gateway link below.')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadPreview()
  }, [assetId])

  useEffect(() => {
    return () => {
      if (blobUrl) URL.revokeObjectURL(blobUrl)
    }
  }, [blobUrl])

  return (
    <div className="w-full h-full bg-dark-800 flex flex-col overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-dark-600 shrink-0 bg-dark-900/60">
        <button
          onClick={() => navigate(-1)}
          className="w-9 h-9 rounded-xl flex items-center justify-center hover:bg-dark-700 transition-colors shrink-0"
          title="Back"
        >
          <IoArrowBackOutline className="w-5 h-5 text-gray-300" />
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-sm font-black uppercase tracking-widest truncate">Asset Preview</h1>
          <p className="text-[10px] text-gray-500 truncate">{assetName || assetId}</p>
        </div>
        <button
          onClick={() => void loadPreview()}
          className="w-9 h-9 rounded-xl flex items-center justify-center hover:bg-dark-700 transition-colors shrink-0"
          title="Reload preview"
        >
          <IoRefreshOutline className={`w-5 h-5 text-gray-400 ${loading ? 'animate-spin-smooth' : ''}`} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar p-3 space-y-3">
        {loading && (
          <>
            <p className="text-xs text-gray-400 animate-breathe">Loading asset metadata and file preview…</p>
            <div className="p-3 rounded-xl border border-dark-600 bg-dark-700/20 space-y-2">
              <div className="h-3 w-20 rounded loading-shimmer" />
              <div className="h-4 w-full rounded loading-shimmer" />
              <div className="h-3 w-16 rounded mt-2 loading-shimmer" />
              <div className="h-4 w-4/5 rounded loading-shimmer" />
            </div>
            <div className="h-48 rounded-xl border border-dark-600 bg-dark-700/20 loading-shimmer" />
          </>
        )}

        {!loading && (
          <div className="p-3 rounded-xl border border-dark-600 bg-dark-700/30 space-y-1">
            <p className="text-[10px] text-gray-500 uppercase font-bold">Asset</p>
            <p className="text-xs font-mono break-all">{assetName || '—'}</p>
            <p className="text-[10px] text-gray-500 uppercase font-bold mt-2">Source</p>
            <p className="text-xs font-mono break-all">{sourceRef || '—'}</p>
            {contentType && (
              <>
                <p className="text-[10px] text-gray-500 uppercase font-bold mt-2">Content type</p>
                <p className="text-xs font-mono break-all">{contentType}</p>
              </>
            )}
          </div>
        )}

        {error && (
          <div className="p-3 rounded-xl border border-red-500/30 bg-red-900/20 text-xs text-red-300 break-words">
            {error}
          </div>
        )}

        {!loading && kind === 'image' && blobUrl && (
          <div className="rounded-xl border border-dark-600 bg-dark-700/30 p-2">
            <img src={blobUrl} alt={assetName || 'Asset preview'} className="w-full h-auto rounded-lg" />
          </div>
        )}

        {!loading && kind === 'pdf' && blobUrl && (
          <div className="rounded-xl border border-dark-600 bg-dark-700/30 overflow-hidden h-[360px]">
            <iframe title="Asset PDF preview" src={blobUrl} className="w-full h-full border-0" />
          </div>
        )}

        {!loading && (kind === 'json' || kind === 'text') && isSolanaNftAsset && (
          <pre className="rounded-xl border border-dark-600 bg-dark-900 p-3 text-[11px] text-gray-300 font-mono whitespace-pre-wrap break-words">
            {textContent || 'No text content to preview.'}
          </pre>
        )}

        {!loading && (kind === 'json' || kind === 'text') && !isSolanaNftAsset && (
          <div className="rounded-xl border border-dark-600 bg-dark-700/30 p-4 flex items-center gap-3">
            <IoDocumentOutline className="w-5 h-5 text-gray-400 shrink-0" />
            <div className="text-xs text-gray-300">Code preview is hidden for non-NFT Solana tokens.</div>
          </div>
        )}

        {!loading && (kind === 'binary' || kind === 'none') && (
          <div className="rounded-xl border border-dark-600 bg-dark-700/30 p-4 flex items-center gap-3">
            <IoDocumentOutline className="w-5 h-5 text-gray-400 shrink-0" />
            <div className="text-xs text-gray-300">Binary or unknown file type. Open/download from a gateway link.</div>
          </div>
        )}

        {!loading && gatewayUrls.length > 0 && (
          <div className="space-y-2">
            {gatewayUrls.map((url) => (
              <a
                key={url}
                href={url}
                target="_blank"
                rel="noreferrer"
                className="w-full inline-flex items-center justify-between rounded-xl border border-dark-600 bg-dark-700/40 px-3 py-2 hover:bg-dark-700 transition-colors"
              >
                <span className="text-[11px] font-mono truncate mr-2">{url}</span>
                <IoOpenOutline className="w-4 h-4 text-gray-300 shrink-0" />
              </a>
            ))}
          </div>
        )}

        {!loading && activeSourceUrl && (
          <a
            href={activeSourceUrl}
            download
            className="w-full inline-flex items-center justify-center rounded-xl border border-primary/40 bg-primary/10 px-3 py-2 text-xs font-bold text-primary hover:bg-primary/20 transition-colors"
          >
            Download file
          </a>
        )}
      </div>
    </div>
  )
}

export default AssetPreviewPage
