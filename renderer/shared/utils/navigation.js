function splitRoute(routePath) {
  const raw = String(routePath || '').trim()
  const [pathWithQuery, hash = ''] = raw.split('#', 2)
  const [pathname, query = ''] = pathWithQuery.split('?', 2)
  const normalizedPath = pathname
    .replace(/^\/+/u, '')
    .replace(/\/+$/u, '')
    .replace(/\.html$/iu, '')

  return {
    pathname: normalizedPath || 'home',
    query: query ? `?${query}` : '',
    hash: hash ? `#${hash}` : '',
  }
}

function resolveManagedStaticRootHref(locationUrl, explicitStaticRootHref) {
  let staticRootHref = explicitStaticRootHref

  if (
    staticRootHref == null &&
    typeof document !== 'undefined' &&
    typeof document.querySelector === 'function'
  ) {
    staticRootHref = document.querySelector(
      'base[data-idena-static-root]'
    )?.href
  }

  if (!staticRootHref) {
    return null
  }

  try {
    const staticRootUrl = new URL(staticRootHref, locationUrl)
    return staticRootUrl.protocol === 'file:' ? staticRootUrl : null
  } catch {
    return null
  }
}

export function resolvePackagedRouteHref(
  routePath,
  locationHref = null,
  staticRootHref = null
) {
  const {pathname, query, hash} = splitRoute(routePath)
  const targetSegments = pathname.split('/').filter(Boolean)
  const targetFile = `${targetSegments.pop() || 'home'}.html`
  const targetDirectorySegments = targetSegments

  const href =
    locationHref ||
    (typeof window !== 'undefined' && window.location && window.location.href
      ? window.location.href
      : '')

  try {
    const locationUrl = new URL(href)

    if (locationUrl.protocol !== 'file:') {
      return `/${pathname}${query}${hash}`
    }

    const staticRootUrl = resolveManagedStaticRootHref(
      locationUrl,
      staticRootHref
    )

    if (staticRootUrl) {
      return new URL(`${pathname}.html${query}${hash}`, staticRootUrl).href
    }

    const outMarker = '/renderer/out/'
    const markerIndex = locationUrl.pathname.lastIndexOf(outMarker)

    if (markerIndex < 0) {
      return `file:///${pathname}${query}${hash}`
    }

    const currentPath = locationUrl.pathname.slice(
      markerIndex + outMarker.length
    )
    const currentSegments = currentPath.split('/').filter(Boolean)
    currentSegments.pop()

    let common = 0
    while (
      common < currentSegments.length &&
      common < targetDirectorySegments.length &&
      currentSegments[common] === targetDirectorySegments[common]
    ) {
      common += 1
    }

    const upSegments = currentSegments.slice(common).map(() => '..')
    const downSegments = targetDirectorySegments.slice(common)
    const relativeSegments = [...upSegments, ...downSegments, targetFile]

    return `${relativeSegments.join('/')}${query}${hash}`
  } catch {
    return `/${pathname}${query}${hash}`
  }
}

export function navigateRendererRoute(router, routePath) {
  const href = resolvePackagedRouteHref(routePath)

  if (
    typeof window !== 'undefined' &&
    window.location &&
    window.location.protocol === 'file:'
  ) {
    window.location.assign(href)
    return
  }

  router.push(routePath)
}

export function navigateRendererRouteFromLink(event, router, routePath) {
  event.preventDefault()
  navigateRendererRoute(router, routePath)
}
