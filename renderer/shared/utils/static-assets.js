function normalizePublicAssetPath(assetPath) {
  const normalized = String(assetPath || '').trim()

  if (!normalized) {
    return ''
  }

  return normalized.startsWith('/') ? normalized : `/${normalized}`
}

export const IDENTITY_MARK_FALLBACK_SRC =
  'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 58 58%22%3E%3Crect width=%2258%22 height=%2258%22 rx=%2214%22 fill=%22%23fff%22/%3E%3Ccircle cx=%2229%22 cy=%2229%22 r=%2222%22 fill=%22%232578f4%22/%3E%3Cpath d=%22M18 39h4l2-5h10l2 5h4L31 18h-4L18 39zm7.3-8 3.7-9 3.7 9h-7.4zM42 39h4V18h-4v21z%22 fill=%22%23fff%22/%3E%3C/svg%3E'

export function useIdentityMarkFallback(event) {
  const target = event && event.currentTarget

  if (!target || target.dataset.identityMarkFallbackApplied === 'true') {
    return
  }

  target.dataset.identityMarkFallbackApplied = 'true'
  target.src = IDENTITY_MARK_FALLBACK_SRC
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
