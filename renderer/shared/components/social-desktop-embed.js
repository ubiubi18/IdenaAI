/* eslint-disable react/prop-types */
import React from 'react'
import {
  Box,
  Button,
  Collapse,
  Flex,
  FormControl,
  FormLabel,
  HStack,
  Input,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  Stack,
  Text,
  Tooltip,
} from '@chakra-ui/react'
import Layout from './layout'
import {SecondaryButton} from './button'
import {ExternalLink, Page, PageTitle, TextLink} from './components'
import {useSettingsState} from '../providers/settings-context'
import {useChainState} from '../providers/chain-context'
import {BASE_API_URL, BASE_INTERNAL_API_PORT} from '../api/api-client'
import {
  SOCIAL_CONTRACT_ADDRESS,
  SOCIAL_EMBED_DOCUMENT_PATH,
  SOCIAL_EMBED_ORIGIN,
  SOCIAL_IMAGE_FORMATS,
  SOCIAL_MAX_IMAGE_BYTES,
  SOCIAL_MESSAGE_CRYPTO_VERSION,
  SOCIAL_DIRECT_V4_CONTRACT,
  SOCIAL_OFFICIAL_INDEXER_URL,
  parseSocialV4DeliveryOrder,
  validateSocialCryptoRequest,
  validateSocialDirectCheckRequest,
  validateSocialRpcRequest,
  isTrustedSocialFrameMessage,
} from './social-desktop-rpc-policy'

export {
  SOCIAL_CONTRACT_ADDRESS,
  SOCIAL_EMBED_DOCUMENT_PATH,
  SOCIAL_EMBED_ORIGIN,
  SOCIAL_IMAGE_FORMATS,
  SOCIAL_MAX_IMAGE_BYTES,
  SOCIAL_MESSAGE_CRYPTO_VERSION,
  SOCIAL_OFFICIAL_INDEXER_URL,
} from './social-desktop-rpc-policy'

const SOCIAL_BOOTSTRAP_STORAGE_KEY = 'idenaSocialDesktopBootstrap'
const SOCIAL_HISTORY_MODE_STORAGE_KEY = 'idenaSocialDesktopHistoryModeV3'
const SOCIAL_HISTORY_MODE_SESSION_STORAGE_KEY =
  'idenaSocialDesktopHistoryModeSessionV1'
const SOCIAL_HISTORY_MODE_LEGACY_STORAGE_KEY = 'idenaSocialDesktopHistoryModeV2'
const SOCIAL_BOOTSTRAP_MESSAGE_TYPE = 'IDENA_SOCIAL_BOOTSTRAP'
const SOCIAL_BOOTSTRAP_READY_MESSAGE_TYPE = 'IDENA_SOCIAL_READY'
const SOCIAL_CHANNEL_INIT_MESSAGE_TYPE = 'IDENA_SOCIAL_CHANNEL_INIT'
const SOCIAL_RPC_REQUEST_MESSAGE_TYPE = 'IDENA_SOCIAL_RPC_REQUEST'
const SOCIAL_RPC_RESPONSE_MESSAGE_TYPE = 'IDENA_SOCIAL_RPC_RESPONSE'
const SOCIAL_CRYPTO_REQUEST_MESSAGE_TYPE = 'IDENA_SOCIAL_CRYPTO_REQUEST'
const SOCIAL_CRYPTO_RESPONSE_MESSAGE_TYPE = 'IDENA_SOCIAL_CRYPTO_RESPONSE'
const SOCIAL_DIRECT_CHECK_REQUEST_MESSAGE_TYPE =
  'IDENA_SOCIAL_DIRECT_CHECK_REQUEST'
const SOCIAL_DIRECT_CHECK_RESPONSE_MESSAGE_TYPE =
  'IDENA_SOCIAL_DIRECT_CHECK_RESPONSE'
const SOCIAL_DIRECT_RECEIVE_REQUEST_MESSAGE_TYPE =
  'IDENA_SOCIAL_DIRECT_RECEIVE_REQUEST'
const SOCIAL_DIRECT_RECEIVE_RESPONSE_MESSAGE_TYPE =
  'IDENA_SOCIAL_DIRECT_RECEIVE_RESPONSE'
const DIRECT_V3_CONTRACT = '6bc41502f4611d041a986cda580209d7f5a4e0d4'
const DIRECT_V4_CONTRACT = SOCIAL_DIRECT_V4_CONTRACT

function formatBytesAsMib(bytes) {
  return `${(bytes / (1024 * 1024)).toFixed(0)} MB`
}

// eslint-disable-next-line react/prop-types
function InfoHint({label}) {
  return (
    <Tooltip
      label={label}
      hasArrow
      placement="top"
      openDelay={150}
      maxW="sm"
      px={3}
      py={2}
      fontSize="sm"
    >
      <Box
        as="span"
        display="inline-flex"
        alignItems="center"
        justifyContent="center"
        w="18px"
        h="18px"
        borderRadius="full"
        borderWidth="1px"
        borderColor="gray.300"
        color="gray.500"
        fontSize="11px"
        fontWeight={700}
        cursor="help"
      >
        i
      </Box>
    </Tooltip>
  )
}

export function buildSocialNodeBootstrap(
  settings,
  historyMode,
  overrides = {}
) {
  const nodeUrl = settings.useExternalNode
    ? settings.url || BASE_API_URL
    : `http://127.0.0.1:${settings.internalPort || BASE_INTERNAL_API_PORT}`

  return {
    embeddedMode: 'desktop-onchain',
    nodeUrl,
    indexerApiUrl: SOCIAL_OFFICIAL_INDEXER_URL,
    sendingTxs: 'rpc',
    findingPastPosts: historyMode,
    messageCrypto: SOCIAL_MESSAGE_CRYPTO_VERSION,
    ...overrides,
  }
}

export default function SocialDesktopEmbed({
  title = 'idena.social',
  description,
  headerContent = null,
  footerContent = null,
  bootstrapOverrides = null,
  iframeTitle = 'idena.social',
}) {
  const settings = useSettingsState()
  const {offline, syncing} = useChainState()
  const {internalPort, url, useExternalNode} = settings

  const [iframeNonce, setIframeNonce] = React.useState(0)
  const [bootstrapReady, setBootstrapReady] = React.useState(false)
  const [historyMode, setHistoryMode] = React.useState('indexer-api')
  const [showTechnicalDetails, setShowTechnicalDetails] = React.useState(false)
  const [receiveRequest, setReceiveRequest] = React.useState(null)
  const [vaultPassphrase, setVaultPassphrase] = React.useState('')
  const [vaultPassphraseRepeat, setVaultPassphraseRepeat] = React.useState('')
  const [savingVault, setSavingVault] = React.useState(false)
  const [vaultInputError, setVaultInputError] = React.useState('')
  const [savedVault, setSavedVault] = React.useState(false)
  const [confirmation, setConfirmation] = React.useState(null)
  const [vaultFolderError, setVaultFolderError] = React.useState('')
  const iframeRef = React.useRef(null)
  const messagePortRef = React.useRef(null)
  const receiveRequestRef = React.useRef(null)
  const savingVaultRef = React.useRef(false)

  React.useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.removeItem(SOCIAL_BOOTSTRAP_STORAGE_KEY)

    const sessionMode = window.sessionStorage.getItem(
      SOCIAL_HISTORY_MODE_SESSION_STORAGE_KEY
    )
    const savedMode = window.localStorage.getItem(
      SOCIAL_HISTORY_MODE_STORAGE_KEY
    )
    const legacySavedMode = window.localStorage.getItem(
      SOCIAL_HISTORY_MODE_LEGACY_STORAGE_KEY
    )

    if (sessionMode === 'rpc' || sessionMode === 'indexer-api') {
      setHistoryMode(sessionMode)
      return
    }

    if (savedMode === 'indexer-api' || legacySavedMode === 'indexer-api') {
      setHistoryMode('indexer-api')
      return
    }

    if (savedMode === 'rpc' || legacySavedMode === 'rpc') {
      window.localStorage.removeItem(SOCIAL_HISTORY_MODE_STORAGE_KEY)
      window.localStorage.removeItem(SOCIAL_HISTORY_MODE_LEGACY_STORAGE_KEY)
    }
  }, [])

  const bootstrap = React.useMemo(
    () =>
      buildSocialNodeBootstrap(
        {
          internalPort,
          url,
          useExternalNode,
        },
        historyMode === 'indexer-api' ? 'indexer-api' : 'rpc',
        bootstrapOverrides || {}
      ),
    [bootstrapOverrides, historyMode, internalPort, url, useExternalNode]
  )

  React.useEffect(() => {
    if (typeof window === 'undefined') return

    window.sessionStorage.setItem(
      SOCIAL_HISTORY_MODE_SESSION_STORAGE_KEY,
      historyMode
    )

    if (historyMode === 'indexer-api') {
      window.localStorage.setItem(SOCIAL_HISTORY_MODE_STORAGE_KEY, historyMode)
      window.localStorage.setItem(
        SOCIAL_HISTORY_MODE_LEGACY_STORAGE_KEY,
        historyMode
      )
      return
    }

    window.localStorage.removeItem(SOCIAL_HISTORY_MODE_STORAGE_KEY)
    window.localStorage.removeItem(SOCIAL_HISTORY_MODE_LEGACY_STORAGE_KEY)
  }, [historyMode])

  const postBootstrapToIframe = React.useCallback(() => {
    const port = messagePortRef.current

    if (!port) {
      return false
    }

    port.postMessage({
      type: SOCIAL_BOOTSTRAP_MESSAGE_TYPE,
      payload: bootstrap,
    })

    return true
  }, [bootstrap])

  const handlePortMessage = React.useCallback(async (port, event) => {
    const nextPayload =
      event.data && typeof event.data === 'object' ? event.data : null

    if (nextPayload?.type === SOCIAL_BOOTSTRAP_READY_MESSAGE_TYPE) {
      setBootstrapReady(true)
      return
    }

    if (
      nextPayload?.type !== SOCIAL_RPC_REQUEST_MESSAGE_TYPE &&
      nextPayload?.type !== SOCIAL_CRYPTO_REQUEST_MESSAGE_TYPE &&
      nextPayload?.type !== SOCIAL_DIRECT_CHECK_REQUEST_MESSAGE_TYPE &&
      nextPayload?.type !== SOCIAL_DIRECT_RECEIVE_REQUEST_MESSAGE_TYPE
    ) {
      return
    }

    if (nextPayload.type === SOCIAL_DIRECT_CHECK_REQUEST_MESSAGE_TYPE) {
      const {payload} = nextPayload
      const {requestId: checkRequestId} = payload || {}
      let response
      if (validateSocialDirectCheckRequest(payload)) {
        response = {error: {message: 'Invalid flip delivery request.'}}
      } else {
        try {
          const check = window.idena?.social?.directCheck
          if (typeof check !== 'function')
            throw new Error('Local verification is unavailable.')
          response = await check({message: payload.message})
        } catch {
          response = {error: {message: 'Local verification is unavailable.'}}
        }
      }
      port.postMessage({
        type: SOCIAL_DIRECT_CHECK_RESPONSE_MESSAGE_TYPE,
        payload: {requestId: checkRequestId, response},
      })
      return
    }

    if (nextPayload.type === SOCIAL_DIRECT_RECEIVE_REQUEST_MESSAGE_TYPE) {
      const {payload} = nextPayload
      const {requestId: receiveRequestId} = payload || {}
      const receiveValidationError = validateSocialDirectCheckRequest(payload)
      if (
        receiveValidationError ||
        receiveRequestRef.current ||
        savingVaultRef.current
      ) {
        port.postMessage({
          type: SOCIAL_DIRECT_RECEIVE_RESPONSE_MESSAGE_TYPE,
          payload: {
            requestId: receiveRequestId,
            response: {
              error: {
                message: receiveValidationError
                  ? 'Invalid flip delivery request.'
                  : 'A vault save is already open.',
              },
            },
          },
        })
      } else {
        let confirmableDelivery = false
        try {
          confirmableDelivery = [DIRECT_V3_CONTRACT, DIRECT_V4_CONTRACT].includes(
            JSON.parse(payload.message).contract
          )
        } catch {
          // The native verifier will reject malformed delivery messages.
        }
        const request = {
          port,
          requestId: receiveRequestId,
          message: payload.message,
          confirmableDelivery,
          savedPayment: parseSocialV4DeliveryOrder(payload.message),
        }
        receiveRequestRef.current = request
        setSavedVault(false)
        setConfirmation(null)
        setVaultFolderError('')
        setReceiveRequest(request)
        setVaultInputError('')
      }
      return
    }

    if (nextPayload.type === SOCIAL_CRYPTO_REQUEST_MESSAGE_TYPE) {
      const {requestId: cryptoRequestId, ...cryptoPayload} =
        nextPayload.payload && typeof nextPayload.payload === 'object'
          ? nextPayload.payload
          : {}
      const cryptoValidationError = validateSocialCryptoRequest(
        cryptoRequestId,
        cryptoPayload
      )

      let cryptoResponsePayload
      if (cryptoValidationError) {
        cryptoResponsePayload = {error: {message: cryptoValidationError}}
      } else {
        try {
          const cryptoBridge =
            window.idena &&
            window.idena.social &&
            typeof window.idena.social.crypto === 'function'
              ? window.idena.social.crypto
              : null

          if (!cryptoBridge) {
            throw new Error('social_crypto_bridge_unavailable')
          }
          cryptoResponsePayload = await cryptoBridge(cryptoPayload)
        } catch (error) {
          cryptoResponsePayload = {
            error: {message: error?.message || 'social_crypto_proxy_failed'},
          }
        }
      }

      port.postMessage({
        type: SOCIAL_CRYPTO_RESPONSE_MESSAGE_TYPE,
        payload: {
          requestId: cryptoRequestId,
          response: cryptoResponsePayload || {},
        },
      })
      return
    }

    const {requestId, method, params} =
      nextPayload.payload && typeof nextPayload.payload === 'object'
        ? nextPayload.payload
        : {}

    if (typeof requestId !== 'string' || typeof method !== 'string') {
      return
    }

    const validationError = validateSocialRpcRequest(requestId, method, params)

    if (validationError) {
      port.postMessage({
        type: SOCIAL_RPC_RESPONSE_MESSAGE_TYPE,
        payload: {
          requestId,
          response: {error: {message: validationError}},
        },
      })
      return
    }

    let responsePayload = {}

    try {
      const socialBridge =
        window.idena &&
        window.idena.social &&
        typeof window.idena.social.rpc === 'function'
          ? window.idena.social
          : null

      if (!socialBridge) {
        throw new Error('social_rpc_bridge_unavailable')
      }

      responsePayload = await socialBridge.rpc({
        requestId,
        method,
        params: Array.isArray(params) ? params : [],
      })
    } catch (error) {
      responsePayload = {
        error: {message: error?.message || 'social_rpc_proxy_failed'},
      }
    }

    port.postMessage({
      type: SOCIAL_RPC_RESPONSE_MESSAGE_TYPE,
      payload: {requestId, response: responsePayload},
    })
  }, [])

  const closeMessagePort = React.useCallback(() => {
    if (receiveRequestRef.current) {
      const request = receiveRequestRef.current
      receiveRequestRef.current = null
      try {
        request.port.postMessage({
          type: SOCIAL_DIRECT_RECEIVE_RESPONSE_MESSAGE_TYPE,
          payload: {
            requestId: request.requestId,
            response: {error: {message: 'Vault save cancelled.'}},
          },
        })
      } catch {
        // The embedded view may already have closed its port.
      }
      setReceiveRequest(null)
      setVaultPassphrase('')
      setVaultPassphraseRepeat('')
    }
    if (messagePortRef.current) {
      messagePortRef.current.close()
      messagePortRef.current = null
    }
  }, [])

  const cancelVaultSave = React.useCallback(() => {
    if (savingVaultRef.current || !receiveRequestRef.current) return
    const {current: request} = receiveRequestRef
    receiveRequestRef.current = null
    try {
      request.port.postMessage({
        type: SOCIAL_DIRECT_RECEIVE_RESPONSE_MESSAGE_TYPE,
        payload: {
          requestId: request.requestId,
          response: {error: {message: 'Vault save cancelled.'}},
        },
      })
    } catch {
      // The embedded view may already have closed its port.
    }
    setReceiveRequest(null)
    setVaultPassphrase('')
    setVaultPassphraseRepeat('')
    setVaultInputError('')
  }, [])

  const confirmSavedVault = React.useCallback(async ({orderId, contract}) => {
    setConfirmation({orderId, contract, status: 'confirming'})
    let status = 'failed'
    try {
      const confirm = window.idena?.social?.directConfirm
      if (typeof confirm !== 'function')
        throw new Error('Local payment confirmation is unavailable.')
      const response = await confirm({orderId, contract})
      if (
        response?.result?.orderId === orderId &&
        ['settled', 'pending'].includes(response.result.status)
      ) {
        status = response.result.status
      }
    } catch {
      // The keys remain saved even when payment confirmation cannot complete.
    }
    setConfirmation((current) =>
      current?.orderId === orderId && current?.contract === contract
        ? {...current, status}
        : current
    )
    return status
  }, [])

  const confirmExistingVault = React.useCallback(async () => {
    const request = receiveRequestRef.current
    if (!request?.savedPayment || savingVaultRef.current) return
    savingVaultRef.current = true
    setSavingVault(true)
    const status = await confirmSavedVault(request.savedPayment)
    savingVaultRef.current = false
    setSavingVault(false)
    if (receiveRequestRef.current !== request) return
    receiveRequestRef.current = null
    setReceiveRequest(null)
    try {
      request.port.postMessage({
        type: SOCIAL_DIRECT_RECEIVE_RESPONSE_MESSAGE_TYPE,
        payload: {
          requestId: request.requestId,
          response:
            status === 'settled' || status === 'pending'
              ? {
                  result: {
                    orderId: request.savedPayment.orderId,
                    confirmationStatus: status,
                  },
                }
              : {error: {message: 'Could not confirm saved payment.'}},
        },
      })
    } catch {
      // The embedded view may already have closed its port.
    }
  }, [confirmSavedVault])

  const saveVerifiedVault = React.useCallback(async () => {
    const request = receiveRequestRef.current
    if (!request || savingVaultRef.current) return
    const codepoints = Array.from(vaultPassphrase)
    if (
      codepoints.length < 12 ||
      codepoints.length > 512 ||
      vaultPassphrase.includes('\0')
    ) {
      setVaultInputError('Use a passphrase between 12 and 512 characters.')
      return
    }
    if (vaultPassphrase !== vaultPassphraseRepeat) {
      setVaultInputError('Passphrases do not match.')
      return
    }
    setVaultInputError('')
    savingVaultRef.current = true
    setSavingVault(true)
    let response
    try {
      const receive = window.idena?.social?.directReceive
      if (typeof receive !== 'function')
        throw new Error('Local vault save is unavailable.')
      response = await receive({
        message: request.message,
        passphrase: vaultPassphrase,
      })
    } catch {
      response = {error: {message: 'Could not save verified keys locally.'}}
    }
    setVaultPassphrase('')
    setVaultPassphraseRepeat('')
    savingVaultRef.current = false
    setSavingVault(false)
    const result = response?.result
    if (result?.saved === true) setSavedVault(true)
    if (receiveRequestRef.current === request) {
      receiveRequestRef.current = null
      setReceiveRequest(null)
      try {
        request.port.postMessage({
          type: SOCIAL_DIRECT_RECEIVE_RESPONSE_MESSAGE_TYPE,
          payload: {
            requestId: request.requestId,
            response:
              result?.saved === true
                ? {
                    result: {
                      orderId: result.orderId,
                      author: result.author,
                      epoch: result.epoch,
                      usableFlips: result.usableFlips,
                      saved: true,
                    },
                  }
                : {
                    error: {
                      message:
                        response?.error?.message ||
                        'Could not save verified keys locally.',
                    },
                  },
          },
        })
      } catch {
        // The embedded view may already have closed its port.
      }
    }
    if (result?.saved === true && result.canConfirm === true) {
      confirmSavedVault({orderId: result.orderId, contract: result.contract})
    }
  }, [confirmSavedVault, vaultPassphrase, vaultPassphraseRepeat])

  const openSavedVaultFolder = React.useCallback(async () => {
    try {
      const result = await window.idena?.social?.openDirectVaultFolder?.()
      if (result?.result?.opened !== true) throw new Error('open_failed')
      setVaultFolderError('')
    } catch {
      setVaultFolderError('Could not open the saved keys folder.')
    }
  }, [])

  const initializeIframeChannel = React.useCallback(() => {
    const frameWindow = iframeRef.current?.contentWindow

    if (!frameWindow || typeof window.MessageChannel !== 'function') {
      return false
    }

    closeMessagePort()
    setBootstrapReady(false)

    const channel = new window.MessageChannel()
    messagePortRef.current = channel.port1
    channel.port1.onmessage = (event) => {
      handlePortMessage(channel.port1, event)
    }
    channel.port1.start()

    frameWindow.postMessage(
      {type: SOCIAL_CHANNEL_INIT_MESSAGE_TYPE},
      SOCIAL_EMBED_ORIGIN,
      [channel.port2]
    )
    channel.port1.postMessage({
      type: SOCIAL_BOOTSTRAP_MESSAGE_TYPE,
      payload: bootstrap,
    })

    return true
  }, [bootstrap, closeMessagePort, handlePortMessage])

  React.useEffect(() => {
    if (typeof window === 'undefined') return undefined

    const handleReadyMessage = (event) => {
      if (
        !isTrustedSocialFrameMessage(event, iframeRef.current?.contentWindow) ||
        event.data?.type !== SOCIAL_BOOTSTRAP_READY_MESSAGE_TYPE ||
        bootstrapReady
      ) {
        return
      }

      initializeIframeChannel()
    }

    window.addEventListener('message', handleReadyMessage)
    return () => window.removeEventListener('message', handleReadyMessage)
  }, [bootstrapReady, initializeIframeChannel])

  React.useEffect(() => {
    setBootstrapReady(false)
    closeMessagePort()
    return closeMessagePort
  }, [closeMessagePort, iframeNonce])

  React.useEffect(() => {
    postBootstrapToIframe()
  }, [postBootstrapToIframe])

  const usingIndexerFallback = historyMode === 'indexer-api'
  const socialViewportHeight = showTechnicalDetails
    ? 'calc(100vh - 184px)'
    : 'calc(100vh - 90px)'

  return (
    <Layout>
      <Page px={0} py={0} overflow="hidden" align="stretch">
        <Box px={8} pt={2} pb={1} w="full">
          <Stack spacing={2} maxW="7xl">
            <Flex
              direction={{base: 'column', lg: 'row'}}
              align={{base: 'flex-start', lg: 'flex-end'}}
              justify="space-between"
              gap={3}
            >
              <Box minW={0}>
                <PageTitle mb={0} lineHeight="shorter">
                  {title}
                </PageTitle>
                <Text
                  color="muted"
                  fontSize="sm"
                  lineHeight="base"
                  noOfLines={1}
                >
                  Posting stays on your node. Community history can use the
                  official indexer fallback for a broader feed.
                </Text>
              </Box>
              <HStack spacing={2} flexWrap="wrap">
                <SecondaryButton
                  size="sm"
                  onClick={() => setIframeNonce((value) => value + 1)}
                >
                  Reload social view
                </SecondaryButton>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setHistoryMode((currentMode) =>
                      currentMode === 'rpc' ? 'indexer-api' : 'rpc'
                    )
                    setIframeNonce((value) => value + 1)
                  }}
                >
                  {usingIndexerFallback
                    ? 'Try node RPC-only history (advanced)'
                    : 'Restore full history (official indexer)'}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowTechnicalDetails((value) => !value)}
                >
                  {showTechnicalDetails ? 'Hide details' : 'Show details'}
                </Button>
              </HStack>
            </Flex>
            {headerContent}
            <HStack spacing={3} flexWrap="wrap">
              <Text color="muted" fontSize="xs">
                {usingIndexerFallback
                  ? 'Community history: official indexer'
                  : 'Community history: node RPC only'}
              </Text>
              <Text color="muted" fontSize="xs">
                Posting: your own node RPC
              </Text>
            </HStack>
            {usingIndexerFallback ? (
              <Text color="green.500" fontSize="xs" lineHeight="tall">
                Recommended mode is active. Community history is read from the
                official indexer, while posting still uses your own node RPC.
              </Text>
            ) : (
              <Text color="orange.500" fontSize="xs" lineHeight="tall">
                RPC-only history is an advanced temporary mode. It can miss
                older posts, your own past posts, or content your current node
                cannot fetch from IPFS right now. Switch back to the official
                indexer for reliable browsing.
              </Text>
            )}
            {(offline || syncing) && (
              <Text color="orange.500" fontSize="xs" lineHeight="tall">
                Your node is currently {offline ? 'offline' : 'syncing'}. The
                social view may stay read-only or temporarily unavailable until
                RPC becomes healthy.
              </Text>
            )}
            <Collapse in={showTechnicalDetails} animateOpacity>
              <Stack spacing={2} pt={0}>
                <HStack spacing={4} flexWrap="wrap" align="center">
                  <HStack spacing={2}>
                    <Text fontSize="sm" lineHeight="short">
                      Node: <strong>{bootstrap.nodeUrl}</strong>
                    </Text>
                    <InfoHint label="This embedded social view uses your current idena-desktop node endpoint. RPC authentication stays in the parent desktop app and is proxied to the embedded view instead of being injected into the iframe." />
                  </HStack>
                  <HStack spacing={2}>
                    <Text fontSize="sm" lineHeight="short">
                      Sending: <strong>RPC only</strong>
                    </Text>
                    <InfoHint label="Posting, liking, tipping and image uploads use only your own node RPC. Picture bytes are first stored through your node IPFS path, then referenced on-chain by CID." />
                  </HStack>
                  <HStack spacing={2}>
                    <Text fontSize="sm" lineHeight="short">
                      History scan:{' '}
                      <strong>
                        {usingIndexerFallback
                          ? 'official indexer fallback (recommended)'
                          : 'RPC only'}
                      </strong>
                    </Text>
                    <InfoHint
                      label={
                        usingIndexerFallback
                          ? `Older posts are currently loaded from the official Idena indexer at ${SOCIAL_OFFICIAL_INDEXER_URL}. This is read-only fallback for history lookup. Posting still goes through your own node RPC.`
                          : 'Older posts are currently searched only through your own node RPC and IPFS path. This can miss posts whenever the backfill is shallow or your current node cannot fetch the stored CID.'
                      }
                    />
                  </HStack>
                  <HStack spacing={2}>
                    <Text fontSize="sm" lineHeight="short">
                      Image posts:{' '}
                      <strong>
                        {formatBytesAsMib(SOCIAL_MAX_IMAGE_BYTES)} max
                      </strong>
                    </Text>
                    <InfoHint
                      label={`Supported formats: ${SOCIAL_IMAGE_FORMATS.join(
                        ', '
                      )}. An image post adds one dna_storeToIpfs transaction for the file plus one contract_call for the message. Text above 100 characters adds another IPFS storage transaction.`}
                    />
                  </HStack>
                  <HStack spacing={2}>
                    <Text fontSize="sm" lineHeight="short">
                      Fees: <strong>live max-fee estimate in composer</strong>
                    </Text>
                    <InfoHint label="The composer inside the social view shows a conservative max-fee estimate from your own node RPC for the current draft. The final charged fee can be lower." />
                  </HStack>
                </HStack>
                {description ? (
                  <Text color="muted" fontSize="sm" lineHeight="tall">
                    {description}
                  </Text>
                ) : null}
                <HStack spacing={3} flexWrap="wrap">
                  <TextLink href="/settings/node" fontSize="sm">
                    Node settings
                  </TextLink>
                  <ExternalLink
                    fontSize="sm"
                    href={`https://scan.idena.io/contract/${SOCIAL_CONTRACT_ADDRESS}`}
                  >
                    Contract on scan.idena.io
                  </ExternalLink>
                </HStack>
                <Text color="muted" fontSize="xs" lineHeight="tall">
                  {usingIndexerFallback
                    ? `Community history is currently read from ${SOCIAL_OFFICIAL_INDEXER_URL}. Posting still stays on your own node RPC.`
                    : 'RPC-only history is active for this session only. This mode can miss posts whenever block backfill is shallow or your node IPFS path cannot currently fetch the stored content.'}
                </Text>
                {footerContent}
              </Stack>
            </Collapse>
          </Stack>
        </Box>

        <Flex flex={1} w="full" px={8} pb={6} minH="0">
          <Box position="relative" w="full" h={socialViewportHeight}>
            <Box
              as="iframe"
              ref={iframeRef}
              key={`${historyMode}:${iframeNonce}`}
              src={SOCIAL_EMBED_DOCUMENT_PATH}
              title={iframeTitle}
              w="full"
              h="full"
              border="1px solid"
              borderColor="gray.100"
              borderRadius="lg"
              bg="white"
              referrerPolicy="no-referrer"
              sandbox="allow-scripts allow-same-origin"
              onLoad={() => {
                closeMessagePort()
                initializeIframeChannel()
              }}
            />
            {!bootstrapReady && (
              <Flex
                position="absolute"
                inset={0}
                align="center"
                justify="center"
                borderRadius="lg"
                bg="whiteAlpha.900"
                pointerEvents="none"
              >
                <Text color="muted">Preparing local social view…</Text>
              </Flex>
            )}
          </Box>
        </Flex>
      </Page>
      <Modal
        isOpen={Boolean(receiveRequest || savedVault)}
        onClose={savedVault ? () => setSavedVault(false) : cancelVaultSave}
        isCentered
        closeOnOverlayClick={!savingVault}
        closeOnEsc={!savingVault}
      >
        <ModalOverlay />
        <ModalContent>
          {savedVault ? (
            <>
              <ModalHeader>Verified keys saved</ModalHeader>
              <ModalBody>
                <Text fontSize="sm" color="muted">
                  The encrypted vault is in this identity’s app profile. Keep
                  your passphrase to open it later.
                </Text>
                {confirmation && (
                  <>
                    <Text
                      fontSize="sm"
                      color={
                        confirmation.status === 'settled' ? 'green.600' : 'muted'
                      }
                      mt={2}
                      role="status"
                    >
                      {confirmation.status === 'settled'
                        ? 'Payment confirmed on-chain.'
                        : confirmation.status === 'confirming'
                          ? 'Confirming payment on-chain…'
                          : confirmation.status === 'pending'
                            ? 'Payment confirmation is pending.'
                            : 'Payment confirmation failed. Your keys are saved.'}
                    </Text>
                    {['pending', 'failed'].includes(confirmation.status) && (
                      <Button
                        variant="link"
                        size="sm"
                        mt={1}
                        onClick={() => confirmSavedVault(confirmation)}
                      >
                        Retry confirmation
                      </Button>
                    )}
                  </>
                )}
                {vaultFolderError && (
                  <Text color="red.500" fontSize="sm" role="alert">
                    {vaultFolderError}
                  </Text>
                )}
              </ModalBody>
              <ModalFooter>
                <Button
                  variant="ghost"
                  mr={3}
                  onClick={() => setSavedVault(false)}
                >
                  Close
                </Button>
                <Button colorScheme="blue" onClick={openSavedVaultFolder}>
                  Open keys folder
                </Button>
              </ModalFooter>
            </>
          ) : (
            <form
              onSubmit={(event) => {
                event.preventDefault()
                saveVerifiedVault()
              }}
            >
              <ModalHeader>
                {receiveRequest?.savedPayment
                  ? 'Save keys or confirm payment'
                  : 'Save verified flip keys'}
              </ModalHeader>
              <ModalBody>
                <Stack spacing={4}>
                  <Text fontSize="sm" color="muted">
                    {receiveRequest?.savedPayment ? (
                      <>
                        Order {receiveRequest.savedPayment.orderId}: save
                        verified keys with a passphrase, or confirm payment for
                        keys already saved. A new on-chain confirmation can cost
                        up to 3 iDNA. Keep your passphrase.
                      </>
                    ) : (
                        <>
                          The app will verify the original flips again and save
                          an encrypted vault in this app profile.
                          {receiveRequest?.confirmableDelivery &&
                            ' Saving valid keys also submits an on-chain payment confirmation, with a network fee capped at 3 iDNA.'}{' '}
                          Keep this passphrase; it cannot be recovered.
                        </>
                      )}
                  </Text>
                  <FormControl>
                    <FormLabel htmlFor="fod-vault-passphrase">
                      Vault passphrase
                    </FormLabel>
                    <Input
                      id="fod-vault-passphrase"
                      type="password"
                      autoComplete="off"
                      value={vaultPassphrase}
                      maxLength={512}
                      onChange={(event) =>
                        setVaultPassphrase(event.target.value)
                      }
                      autoFocus
                    />
                  </FormControl>
                  <FormControl>
                    <FormLabel htmlFor="fod-vault-passphrase-repeat">
                      Repeat passphrase
                    </FormLabel>
                    <Input
                      id="fod-vault-passphrase-repeat"
                      type="password"
                      autoComplete="off"
                      value={vaultPassphraseRepeat}
                      maxLength={512}
                      onChange={(event) =>
                        setVaultPassphraseRepeat(event.target.value)
                      }
                    />
                  </FormControl>
                  {vaultInputError && (
                    <Text color="red.500" fontSize="sm" role="alert">
                      {vaultInputError}
                    </Text>
                  )}
                </Stack>
              </ModalBody>
              <ModalFooter>
                <Button
                  variant="ghost"
                  mr={3}
                  onClick={cancelVaultSave}
                  isDisabled={savingVault}
                >
                  Cancel
                </Button>
                {receiveRequest?.savedPayment && (
                  <Button
                    variant="outline"
                    mr={3}
                    type="button"
                    isLoading={savingVault}
                    onClick={confirmExistingVault}
                  >
                    Confirm saved payment
                  </Button>
                )}
                <Button
                  colorScheme="blue"
                  type="submit"
                  isLoading={savingVault}
                >
                  {receiveRequest?.confirmableDelivery
                    ? 'Save keys and confirm payment'
                    : 'Save verified keys'}
                </Button>
              </ModalFooter>
            </form>
          )}
        </ModalContent>
      </Modal>
    </Layout>
  )
}
