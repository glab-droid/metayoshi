export interface NetworkCapabilitySet {
  features: {
    nativeSend: boolean
    assetLayer: boolean
    assetSend: boolean
    activity: boolean
  }
  ui: {
    showAssetsTab: boolean
    showAssetsAction: boolean
    showSendAction: boolean
    showActivityTab: boolean
  }
}

export interface NetworkCapabilitiesInput {
  features?: Partial<NetworkCapabilitySet['features']>
  ui?: Partial<NetworkCapabilitySet['ui']>
}

type CapabilityInput = {
  coinType?: string
  supportsAssets?: boolean
  capabilities?: NetworkCapabilitiesInput
}

const DEFAULT_CAPABILITIES: NetworkCapabilitySet = {
  features: {
    nativeSend: true,
    assetLayer: false,
    assetSend: false,
    activity: true
  },
  ui: {
    showAssetsTab: false,
    showAssetsAction: false,
    showSendAction: true,
    showActivityTab: true
  }
}

export function resolveNetworkCapabilities(net: CapabilityInput): NetworkCapabilitySet {
  const defaults: NetworkCapabilitySet = {
    ...DEFAULT_CAPABILITIES,
    features: {
      ...DEFAULT_CAPABILITIES.features,
      // Back-compat: EVM/SOL and old supportsAssets flag imply asset support
      assetLayer: net.coinType === 'EVM' || net.coinType === 'SOL' || net.supportsAssets === true,
      assetSend: net.coinType === 'EVM' || net.coinType === 'SOL' || net.supportsAssets === true
    },
    ui: {
      ...DEFAULT_CAPABILITIES.ui,
      showAssetsTab: net.coinType === 'EVM' || net.coinType === 'SOL' || net.supportsAssets === true,
      showAssetsAction: net.coinType === 'EVM' || net.coinType === 'SOL' || net.supportsAssets === true
    }
  }

  const merged: NetworkCapabilitySet = {
    features: {
      ...defaults.features,
      ...(net.capabilities?.features ?? {})
    },
    ui: {
      ...defaults.ui,
      ...(net.capabilities?.ui ?? {})
    }
  }

  // EVM chains must always expose asset listing UI, even if a stale persisted
  // capability object still has legacy false flags.
  if (net.coinType === 'EVM') {
    merged.features.assetLayer = true
    merged.features.assetSend = true
    merged.ui.showAssetsTab = true
    merged.ui.showAssetsAction = true
  }

  // Solana must always expose asset listing UI (SPL tokens), even if a stale persisted
  // capability object still has legacy false flags.
  if (net.coinType === 'SOL') {
    merged.features.assetLayer = true
    merged.features.assetSend = true
    merged.ui.showAssetsTab = true
    merged.ui.showAssetsAction = true
  }

  return merged
}

