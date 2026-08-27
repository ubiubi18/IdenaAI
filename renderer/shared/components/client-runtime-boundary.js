/* eslint-disable react/prop-types */
import {Fragment, useEffect, useState} from 'react'

const PRELOAD_READY_EVENT = 'idena-preload-ready'

/**
 * Prepare the client runtime before mounting the Electron renderer tree.
 *
 * The preload persistence bridge is unavailable during Next.js server
 * rendering but is available synchronously in Electron. Rendering providers
 * before mount would therefore give the server and the first client render
 * different persisted state. A late preload bridge replaces the fallback
 * runtime by remounting the provider tree once.
 */
export default function ClientRuntimeBoundary({children, prepareRuntime}) {
  const [runtimeEpoch, setRuntimeEpoch] = useState(null)

  useEffect(() => {
    let bridgeReady = Boolean(prepareRuntime?.())

    setRuntimeEpoch(0)

    const handleBridgeReady = () => {
      const nextBridgeReady = Boolean(prepareRuntime?.())
      const shouldRemount = !bridgeReady && nextBridgeReady
      bridgeReady = nextBridgeReady

      if (shouldRemount) {
        setRuntimeEpoch((value) => value + 1)
      }
    }

    window.addEventListener(PRELOAD_READY_EVENT, handleBridgeReady)

    return () => {
      window.removeEventListener(PRELOAD_READY_EVENT, handleBridgeReady)
    }
  }, [prepareRuntime])

  return runtimeEpoch === null ? null : (
    <Fragment key={runtimeEpoch}>{children}</Fragment>
  )
}
