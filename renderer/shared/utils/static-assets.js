function normalizePublicAssetPath(assetPath) {
  const normalized = String(assetPath || '').trim()

  if (!normalized) {
    return ''
  }

  return normalized.startsWith('/') ? normalized : `/${normalized}`
}

export function resolvePublicAssetPath(assetPath, locationHref = null) {
  const normalizedPath = normalizePublicAssetPath(assetPath)

  if (!normalizedPath) {
    return ''
  }

  const href =
    locationHref ||
    (typeof window !== 'undefined' && window.location && window.location.href
      ? window.location.href
      : '')

  if (!href) {
    return normalizedPath
  }

  try {
    const locationUrl = new URL(href)

    if (locationUrl.protocol !== 'file:') {
      return normalizedPath
    }

    const outMarker = '/renderer/out/'
    const markerIndex = locationUrl.pathname.lastIndexOf(outMarker)

    if (markerIndex < 0) {
      return normalizedPath
    }

    const routePath = locationUrl.pathname.slice(markerIndex + outMarker.length)
    const routeSegments = routePath.split('/').filter(Boolean)
    routeSegments.pop()

    return `${'../'.repeat(routeSegments.length)}${normalizedPath.replace(
      /^\/+/u,
      ''
    )}`
  } catch {
    return normalizedPath
  }
}

export function resolveIdentityMarkSrc(locationHref = null) {
  return resolvePublicAssetPath('/static/identity-mark.png', locationHref)
}
