/* eslint-disable react/prop-types */
import {useEffect, useState} from 'react'

/**
 * Delay the Electron renderer tree until the browser has hydrated.
 *
 * The preload persistence bridge is unavailable during Next.js server
 * rendering but is available synchronously in Electron. Rendering providers
 * before mount would therefore give the server and the first client render
 * different persisted state.
 */
export default function ClientRuntimeBoundary({children}) {
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  return mounted ? children : null
}
