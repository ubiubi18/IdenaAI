import React, {
  useCallback,
  useEffect,
  useReducer,
  useRef,
  useState,
} from 'react'
import {useTranslation} from 'react-i18next'
import Ansi from 'ansi-to-react'
import {useRouter} from 'next/router'
import {
  Box,
  Text,
  Heading,
  Stack,
  InputRightElement,
  InputGroup,
  IconButton,
  Flex,
  useToast,
  Switch,
} from '@chakra-ui/react'
import {PrimaryButton, SecondaryButton} from '../../shared/components/button'
import {BASE_API_URL} from '../../shared/api/api-client'
import {
  useSettingsState,
  useSettingsDispatch,
} from '../../shared/providers/settings-context'
import {
  useNodeState,
  useNodeDispatch,
} from '../../shared/providers/node-context'
import {useChainState} from '../../shared/providers/chain-context'
import {
  HDivider,
  Input,
  Toast,
  Tooltip,
} from '../../shared/components/components'
import {
  SettingsFormControl,
  SettingsFormLabel,
  SettingsSection,
} from '../../screens/settings/components'
import SettingsLayout from '../../screens/settings/layout'
import {CopyIcon, EyeIcon, EyeOffIcon} from '../../shared/components/icons'
import {getNodeBridge} from '../../shared/utils/node-bridge'
import {
  buildRehearsalNetworkPayload,
  REHEARSAL_DEFAULT_SOLVER_PARTICIPANT_COUNT,
  REHEARSAL_NETWORK_VALIDATOR_COUNT,
  REHEARSAL_SHARED_NODE_PARTICIPANT_START_DELAY_MS,
} from '../../shared/utils/rehearsal-devnet'
import {
  canOpenRehearsalValidation,
  getRehearsalValidationEntryPath,
  getRehearsalValidationBlockedReason,
  openValidationLottery,
} from '../../screens/validation/hooks/use-start-validation'

const NODE_SETTINGS_TOAST_ID = 'node-settings-status-toast'
const LOCAL_RPC_KEY_TOAST_ID = 'local-rpc-key-toast'
const APP_NAME = 'IdenaAI'

async function writeClipboardText(text) {
  const value = String(text || '')
  const appClipboard =
    typeof global !== 'undefined' && global.clipboard ? global.clipboard : null

  if (appClipboard && typeof appClipboard.writeText === 'function') {
    try {
      return appClipboard.writeText(value) !== false
    } catch {
      // Fall through to the browser Clipboard API.
    }
  }

  if (typeof document !== 'undefined' && document.body) {
    const textArea = document.createElement('textarea')
    textArea.value = value
    textArea.setAttribute('readonly', '')
    textArea.style.position = 'fixed'
    textArea.style.left = '-9999px'
    textArea.style.top = '0'
    document.body.appendChild(textArea)
    textArea.focus()
    textArea.select()
    textArea.setSelectionRange(0, textArea.value.length)

    try {
      if (document.execCommand('copy')) {
        return true
      }
    } catch {
      // Fall through to navigator.clipboard.
    } finally {
      document.body.removeChild(textArea)
    }
  }

  if (
    typeof navigator === 'undefined' ||
    !navigator.clipboard ||
    typeof navigator.clipboard.writeText !== 'function'
  ) {
    return false
  }

  try {
    await navigator.clipboard.writeText(value)
    return true
  } catch {
    return false
  }
}

// eslint-disable-next-line react/prop-types
function LocalRpcKeyHelp({label}) {
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
        w="20px"
        h="20px"
        borderRadius="full"
        borderWidth="1px"
        borderColor="gray.300"
        color="gray.500"
        fontSize="12px"
        fontWeight={700}
        cursor="help"
      >
        ?
      </Box>
    </Tooltip>
  )
}

function hasNodeBridge() {
  return !getNodeBridge().__idenaFallback
}

function normalizeLogs(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry || '').trimEnd()).filter(Boolean)
  }

  if (typeof value === 'string') {
    return value
      .split('\n')
      .map((entry) => entry.trimEnd())
      .filter(Boolean)
  }

  return []
}

function formatRehearsalHashReadiness(count, readyCount) {
  if (typeof count !== 'number') {
    return '-'
  }

  if (typeof readyCount !== 'number') {
    return String(count)
  }

  return `${readyCount}/${count}`
}

function formatRehearsalNodeAssignment(node) {
  return `${node.name} ${node.role || 'node'}: S ${formatRehearsalHashReadiness(
    node.shortHashCount,
    node.shortHashReadyCount
  )}, L ${formatRehearsalHashReadiness(
    node.longHashCount,
    node.longHashReadyCount
  )}`
}

function formatRehearsalSolverTokenCount(value) {
  const count = Number(value)

  if (!Number.isFinite(count) || count <= 0) {
    return '0'
  }

  return Math.round(count).toLocaleString()
}

function formatRehearsalSolverUsd(value) {
  const amount = Number(value)

  if (!Number.isFinite(amount) || amount < 0) {
    return '-'
  }

  return `$${amount.toFixed(amount >= 1 ? 2 : 4)}`
}

function buildRehearsalLaneProviderConfig(aiSolver = {}) {
  if (aiSolver.provider !== 'openai-compatible') {
    return null
  }

  return {
    name: aiSolver.customProviderName,
    baseUrl: aiSolver.customProviderBaseUrl,
    chatPath: aiSolver.customProviderChatPath,
  }
}

function buildRehearsalSolverLanePayload(
  aiSolver = {},
  {participantCount = REHEARSAL_DEFAULT_SOLVER_PARTICIPANT_COUNT} = {}
) {
  const provider = aiSolver.provider || 'openai'
  const laneCount = Math.max(
    1,
    Math.min(REHEARSAL_NETWORK_VALIDATOR_COUNT, Number(participantCount) || 1)
  )

  return {
    rehearsalOnly: true,
    mode:
      laneCount > 1
        ? 'shared-node-participant-rehearsal'
        : 'single-participant-rehearsal',
    laneCount,
    laneStartDelayMs:
      laneCount > 1 ? REHEARSAL_SHARED_NODE_PARTICIPANT_START_DELAY_MS : 0,
    provider,
    model: aiSolver.model || 'gpt-5.4',
    providerConfig: buildRehearsalLaneProviderConfig(aiSolver),
    ensembleEnabled: Boolean(aiSolver.ensembleEnabled),
    ensemblePrimaryWeight: aiSolver.ensemblePrimaryWeight,
    legacyHeuristicEnabled: Boolean(aiSolver.legacyHeuristicEnabled),
    legacyHeuristicWeight: aiSolver.legacyHeuristicWeight,
    legacyHeuristicOnly: Boolean(aiSolver.legacyHeuristicOnly),
    ensembleProvider2Enabled: Boolean(aiSolver.ensembleProvider2Enabled),
    ensembleProvider2: aiSolver.ensembleProvider2,
    ensembleModel2: aiSolver.ensembleModel2,
    ensembleProvider2Weight: aiSolver.ensembleProvider2Weight,
    ensembleProvider3Enabled: Boolean(aiSolver.ensembleProvider3Enabled),
    ensembleProvider3: aiSolver.ensembleProvider3,
    ensembleModel3: aiSolver.ensembleModel3,
    ensembleProvider3Weight: aiSolver.ensembleProvider3Weight,
    benchmarkProfile: 'custom',
    deadlineMs: 180 * 1000,
    requestTimeoutMs: Math.max(
      90 * 1000,
      Number(aiSolver.requestTimeoutMs) || 0
    ),
    maxConcurrency: 1,
    maxRetries: Number(aiSolver.maxRetries) || 1,
    maxOutputTokens: Number(aiSolver.maxOutputTokens) || 0,
    interFlipDelayMs: 0,
    temperature: Number(aiSolver.temperature) || 0,
    forceDecision: true,
    uncertaintyRepromptEnabled: true,
    uncertaintyConfidenceThreshold:
      Number(aiSolver.uncertaintyConfidenceThreshold) || 0.95,
    uncertaintyRepromptMinRemainingMs: 3000,
    flipVisionMode: 'frames_two_pass',
  }
}

function normalizeDevnetStatus(value) {
  if (!value || typeof value !== 'object') {
    return {
      active: false,
      stage: 'idle',
      message: '',
      error: null,
      primaryRpcUrl: null,
      nodeCount: 0,
      nodes: [],
      countdownSeconds: null,
      firstCeremonyAt: null,
      seedSource: null,
      seedRequestedCount: null,
      seedSubmittedCount: null,
      seedConfirmedCount: null,
      primaryValidationAssigned: false,
      primaryShortHashCount: null,
      primaryShortHashReadyCount: null,
      primaryLongHashCount: null,
      primaryLongHashReadyCount: null,
      parallelSolverLanes: null,
    }
  }

  return {
    active: Boolean(value.active),
    stage: value.stage || 'idle',
    message: value.message || '',
    error: value.error || null,
    primaryRpcUrl: value.primaryRpcUrl || null,
    nodeCount:
      typeof value.nodeCount === 'number' && value.nodeCount >= 0
        ? value.nodeCount
        : 0,
    nodes: Array.isArray(value.nodes) ? value.nodes : [],
    countdownSeconds:
      typeof value.countdownSeconds === 'number'
        ? value.countdownSeconds
        : null,
    firstCeremonyAt: value.firstCeremonyAt || null,
    networkId: value.networkId || null,
    seedSource: value.seedSource || null,
    seedRequestedCount:
      typeof value.seedRequestedCount === 'number'
        ? value.seedRequestedCount
        : null,
    seedSubmittedCount:
      typeof value.seedSubmittedCount === 'number'
        ? value.seedSubmittedCount
        : null,
    seedConfirmedCount:
      typeof value.seedConfirmedCount === 'number'
        ? value.seedConfirmedCount
        : null,
    primaryValidationAssigned: value.primaryValidationAssigned === true,
    primaryShortHashCount:
      typeof value.primaryShortHashCount === 'number'
        ? value.primaryShortHashCount
        : null,
    primaryShortHashReadyCount:
      typeof value.primaryShortHashReadyCount === 'number'
        ? value.primaryShortHashReadyCount
        : null,
    primaryLongHashCount:
      typeof value.primaryLongHashCount === 'number'
        ? value.primaryLongHashCount
        : null,
    primaryLongHashReadyCount:
      typeof value.primaryLongHashReadyCount === 'number'
        ? value.primaryLongHashReadyCount
        : null,
    parallelSolverLanes:
      value.parallelSolverLanes &&
      typeof value.parallelSolverLanes === 'object' &&
      !Array.isArray(value.parallelSolverLanes)
        ? value.parallelSolverLanes
        : null,
  }
}

function NodeSettings() {
  const {t} = useTranslation()
  const router = useRouter()

  const toast = useToast()

  const settings = useSettingsState()

  const {
    toggleUseExternalNode,
    toggleRunInternalNode,
    setConnectionDetails,
    clearEphemeralExternalNode,
    toggleAutoActivateMining,
    updateAiSolverSettings,
  } = useSettingsDispatch()

  const {nodeFailed} = useNodeState()
  const {offline: chainOffline} = useChainState()

  const {tryRestartNode} = useNodeDispatch()

  const logsRef = useRef(null)
  const canUseIpcRenderer = hasNodeBridge()

  const [state, dispatch] = useReducer(
    (prevState, action) => {
      switch (action.type) {
        case 'SET_URL':
          return {
            ...prevState,
            url: action.data,
          }
        case 'SET_API_KEY': {
          return {
            ...prevState,
            apiKey: action.data,
          }
        }
        case 'SET_CONNECTION_DETAILS': {
          return {
            ...prevState,
            ...action,
          }
        }
        case 'NEW_LOG': {
          const nextLogs = normalizeLogs(action.data)
          const prevLogs =
            prevState.logs.length > 200
              ? prevState.logs.slice(-100)
              : prevState.logs
          return {
            ...prevState,
            logs: [...prevLogs, ...nextLogs],
          }
        }
        case 'SET_LAST_LOGS': {
          return {
            ...prevState,
            logs: normalizeLogs(action.data),
          }
        }
        case 'SET_DEVNET_STATUS': {
          return {
            ...prevState,
            devnetStatus: normalizeDevnetStatus(action.data),
          }
        }
        case 'NEW_DEVNET_LOG': {
          const nextLogs = normalizeLogs(action.data)
          const prevLogs =
            prevState.devnetLogs.length > 200
              ? prevState.devnetLogs.slice(-100)
              : prevState.devnetLogs

          return {
            ...prevState,
            devnetLogs: [...prevLogs, ...nextLogs],
          }
        }
        case 'SET_DEVNET_LOGS': {
          return {
            ...prevState,
            devnetLogs: normalizeLogs(action.data),
          }
        }
        default:
      }
    },
    {
      logs: [],
      devnetLogs: [],
      url: settings.url,
      apiKey: settings.externalApiKey,
      devnetStatus: normalizeDevnetStatus(),
    }
  )

  useEffect(() => {
    if (!canUseIpcRenderer) {
      return undefined
    }

    const onEvent = (event, data) => {
      switch (event) {
        case 'node-log':
          if (!settings.useExternalNode) dispatch({type: 'NEW_LOG', data})
          break
        case 'last-node-logs':
          dispatch({type: 'SET_LAST_LOGS', data})
          break
        case 'validation-devnet-status':
          dispatch({type: 'SET_DEVNET_STATUS', data})
          if (!data?.active && settings.ephemeralExternalNodeConnected) {
            clearEphemeralExternalNode()
          }
          break
        case 'validation-devnet-log':
          dispatch({type: 'NEW_DEVNET_LOG', data})
          break
        case 'validation-devnet-logs':
          dispatch({type: 'SET_DEVNET_LOGS', data})
          break
        default:
      }
    }

    return getNodeBridge().onEvent(onEvent)
  }, [canUseIpcRenderer, clearEphemeralExternalNode, dispatch, settings])

  useEffect(() => {
    if (settings.ephemeralExternalNodeConnected) {
      return
    }

    dispatch({
      type: 'SET_CONNECTION_DETAILS',
      url: settings.url,
      apiKey: settings.externalApiKey,
    })
  }, [
    dispatch,
    settings.ephemeralExternalNodeConnected,
    settings.externalApiKey,
    settings.url,
  ])

  useEffect(() => {
    if (canUseIpcRenderer && !settings.useExternalNode) {
      getNodeBridge().getLastLogs()
    }
  }, [canUseIpcRenderer, settings.useExternalNode])

  useEffect(() => {
    if (!canUseIpcRenderer) {
      return
    }

    getNodeBridge().getValidationDevnetStatus()
    getNodeBridge().getValidationDevnetLogs()
  }, [canUseIpcRenderer])

  useEffect(() => {
    if (logsRef.current) {
      logsRef.current.scrollTop = logsRef.current.scrollHeight
    }
  }, [state.logs])

  const notify = () => {
    if (
      typeof toast.isActive === 'function' &&
      typeof toast.close === 'function' &&
      toast.isActive(NODE_SETTINGS_TOAST_ID)
    ) {
      toast.close(NODE_SETTINGS_TOAST_ID)
    }

    toast({
      id: NODE_SETTINGS_TOAST_ID,
      duration: 6000,
      // eslint-disable-next-line react/display-name
      render: () => (
        <Toast
          title={t('Settings updated')}
          description={t('Connected to url', {url: state.url})}
        />
      ),
    })
  }

  const [revealApiKey, setRevealApiKey] = useState(false)
  const [revealInternalApiKey, setRevealInternalApiKey] = useState(false)
  const emptyLogMessage = (() => {
    if (!canUseIpcRenderer) {
      return t(
        'The built-in node log is unavailable because the desktop bridge is not ready.'
      )
    }

    if (nodeFailed) {
      return t(
        'No node log was captured yet. The last startup failed before the live log stream was ready.'
      )
    }

    return t('Node output will appear here after the built-in node starts.')
  })()
  const {devnetStatus} = state
  const isStartingDevnet =
    devnetStatus.stage &&
    !['idle', 'running', 'failed'].includes(devnetStatus.stage)
  const primaryRpcPort = devnetStatus.primaryRpcUrl
    ? Number(String(devnetStatus.primaryRpcUrl).split(':').pop())
    : null
  const primaryDevnetNode =
    devnetStatus.nodes.find(({rpcPort}) => rpcPort === primaryRpcPort) ||
    devnetStatus.nodes[0] ||
    null
  const primaryRehearsalRpcReady = Boolean(primaryDevnetNode?.rpcReady)
  const readyDevnetNodeCount = devnetStatus.nodes.filter(
    ({rpcReady}) => rpcReady
  ).length
  const onlineDevnetNodeCount = devnetStatus.nodes.filter(
    ({online}) => online
  ).length
  const assignedDevnetNodeCount = devnetStatus.nodes.filter(
    ({validationAssigned}) => validationAssigned
  ).length
  const canShowDevnetAssignmentSummary = devnetStatus.nodes.some(
    ({validationAssigned, shortHashCount, longHashCount}) =>
      validationAssigned ||
      typeof shortHashCount === 'number' ||
      typeof longHashCount === 'number'
  )
  const rehearsalCurrentPeriod = primaryDevnetNode?.currentPeriod || null
  const rehearsalNodeConnected =
    settings.ephemeralExternalNodeConnected &&
    devnetStatus.primaryRpcUrl &&
    settings.url === devnetStatus.primaryRpcUrl
  const rehearsalNodeRpcPending =
    rehearsalNodeConnected && chainOffline && primaryRehearsalRpcReady
  const rehearsalNodeRpcUnavailable =
    rehearsalNodeConnected && chainOffline && !primaryRehearsalRpcReady
  const rehearsalNeedsConnection =
    devnetStatus.active && devnetStatus.primaryRpcUrl && !rehearsalNodeConnected
  const rehearsalNodeConnectable =
    rehearsalNeedsConnection && devnetStatus.stage === 'running'
  const rehearsalSessionAlreadyAdvanced =
    rehearsalNodeConnected &&
    ['ShortSession', 'LongSession', 'AfterLongSession'].includes(
      rehearsalCurrentPeriod
    )
  const rehearsalAwaitingFlipLottery =
    rehearsalNeedsConnection &&
    !devnetStatus.primaryValidationAssigned &&
    ![
      'FlipLottery',
      'ShortSession',
      'LongSession',
      'AfterLongSession',
    ].includes(rehearsalCurrentPeriod)
  const rehearsalConnectWarning =
    rehearsalNeedsConnection &&
    ['ShortSession', 'LongSession', 'AfterLongSession'].includes(
      rehearsalCurrentPeriod
    )
  const rehearsalBlockedReason = getRehearsalValidationBlockedReason({
    currentPeriod: rehearsalCurrentPeriod,
    devnetStatus,
    isRehearsalNodeSession: rehearsalNodeConnected,
  })
  const rehearsalValidationOpenable = canOpenRehearsalValidation({
    currentPeriod: rehearsalCurrentPeriod,
    devnetStatus,
    isRehearsalNodeSession: rehearsalNodeConnected,
  })
  const rehearsalCanOpenCountdown =
    rehearsalNodeConnected &&
    !['ShortSession', 'LongSession', 'AfterLongSession'].includes(
      rehearsalCurrentPeriod
    )
  let rehearsalConnectionMessage = ''
  let rehearsalSessionMessage = ''
  const rehearsalCurrentNodeStatusNote =
    rehearsalNeedsConnection &&
    settings.useExternalNode &&
    settings.url &&
    settings.url !== devnetStatus.primaryRpcUrl
      ? t(
          'Until the rehearsal handoff happens, the app sidebar still reflects your current node endpoint ({{url}}), not the rehearsal RPC.',
          {url: settings.url}
        )
      : ''

  if (rehearsalConnectWarning) {
    rehearsalConnectionMessage = t(
      'The rehearsal network is already running, but this app is still on your normal node and the ceremony has already progressed. Restart fresh for a clean run.'
    )
  } else if (rehearsalAwaitingFlipLottery) {
    rehearsalConnectionMessage = t(
      'The rehearsal network is healthy, and you can already switch this app over to the rehearsal node. Validation hashes have not been assigned yet because the primary node is still before FlipLottery.'
    )
  } else if (!devnetStatus.primaryValidationAssigned) {
    rehearsalConnectionMessage = t(
      'The rehearsal network is running and ready for app handoff. The primary node still has no assigned validation flips yet, so validation content will appear later when the ceremony reaches FlipLottery.'
    )
  } else {
    rehearsalConnectionMessage = t(
      'The rehearsal network is running in the background, but this app is still connected to your normal node. Switch this app over when you are ready.'
    )
  }

  if (rehearsalNodeConnected) {
    if (
      rehearsalBlockedReason === 'before-flip-lottery' ||
      rehearsalBlockedReason === 'flip-lottery'
    ) {
      rehearsalSessionMessage = t(
        'Rehearsal node is connected. Open the countdown and stay in the session window; validation content will appear there as soon as real rehearsal flips are ready.'
      )
    } else if (rehearsalBlockedReason === 'hashes-not-assigned') {
      rehearsalSessionMessage = t(
        'Rehearsal node is connected, but validation hashes are still not assigned on the primary node.'
      )
    } else if (rehearsalBlockedReason === 'keys-not-ready') {
      rehearsalSessionMessage = t(
        'Rehearsal node is connected, but flip decryption keys are still syncing. Validation will open once at least one flip is ready.'
      )
    } else if (rehearsalValidationOpenable) {
      rehearsalSessionMessage = t(
        'Rehearsal session is ready to open from this page.'
      )
    }
  }
  const emptyDevnetLogMessage = canUseIpcRenderer
    ? t(
        'Rehearsal-network output will appear here after the private validation network starts.'
      )
    : t(
        'The validation rehearsal network is unavailable because the desktop bridge is not ready.'
      )
  let rehearsalStatusTitle =
    devnetStatus.message || t('Validation rehearsal network is stopped.')
  if (devnetStatus.active && rehearsalSessionAlreadyAdvanced) {
    rehearsalStatusTitle = t(
      'Rehearsal session already reached {{period}}. Restart for a clean autosolve test.',
      {period: rehearsalCurrentPeriod}
    )
  } else if (
    devnetStatus.active &&
    devnetStatus.stage === 'running' &&
    devnetStatus.nodeCount > 0
  ) {
    rehearsalStatusTitle = t(
      'Rehearsal network is running ({{online}}/{{total}} online).',
      {
        online: onlineDevnetNodeCount,
        total: devnetStatus.nodeCount,
      }
    )
  }
  const rehearsalSolverLanes = devnetStatus.parallelSolverLanes
  const rehearsalSolverLaneRunning = rehearsalSolverLanes?.running === true
  const rehearsalSolverLaneSummary = rehearsalSolverLanes?.summary || null
  const rehearsalSolverIsParallel =
    Number(rehearsalSolverLanes?.participantCount || 0) > 1
  const canRunRehearsalSolverLanes =
    devnetStatus.active && devnetStatus.stage === 'running'
  const rehearsalAutosolverArmed =
    settings.aiSolver?.enabled === true &&
    String(settings.aiSolver?.mode || '').trim() === 'session-auto'
  const rehearsalAutosolverManualOnly =
    settings.aiSolver?.enabled === true && !rehearsalAutosolverArmed
  const localRpcKeyHelpText = t(
    'The local RPC key lives as internalApiKey in settings.json inside the current {{appName}} profile. Real app profiles: macOS ~/Library/Application Support/{{appName}}/settings.json, Windows %APPDATA%\\{{appName}}\\settings.json, Linux ~/.config/{{appName}}/settings.json. Edit it only while {{appName}} and its node are stopped, then restart. Rehearsal networks use a different temporary API key managed by the rehearsal node.',
    {appName: APP_NAME}
  )
  let localRpcKeyStatusText = t(
    'This window is using the built-in local node. Real validation, idena.social posting, and local desktop RPC calls use this key through the desktop proxy.'
  )

  if (rehearsalNodeConnected) {
    localRpcKeyStatusText = t(
      'This window is connected to a rehearsal RPC. The rehearsal API key is temporary and managed by the rehearsal node; the local key shown here belongs to the built-in node profile and is not the rehearsal key.'
    )
  } else if (settings.useExternalNode) {
    localRpcKeyStatusText = t(
      'This window is using an external node. The local key shown here belongs to the built-in node profile and is not used until you switch back to the built-in node.'
    )
  }

  const copyLocalRpcKey = async () => {
    if (!settings.internalApiKey) {
      return
    }

    const copied = await writeClipboardText(settings.internalApiKey)

    if (
      typeof toast.isActive === 'function' &&
      typeof toast.close === 'function' &&
      toast.isActive(LOCAL_RPC_KEY_TOAST_ID)
    ) {
      toast.close(LOCAL_RPC_KEY_TOAST_ID)
    }

    toast({
      id: LOCAL_RPC_KEY_TOAST_ID,
      duration: 4000,
      // eslint-disable-next-line react/display-name
      render: () => (
        <Toast
          title={
            copied
              ? t('Local RPC key copied')
              : t('Unable to copy local RPC key')
          }
          description={
            copied
              ? t('Paste it only into tools you trust.')
              : t('Select and copy the local RPC key manually.')
          }
        />
      ),
    })
  }

  const armRehearsalAutosolver = useCallback(() => {
    updateAiSolverSettings({
      enabled: true,
      mode: 'session-auto',
    })
  }, [updateAiSolverSettings])

  const startRehearsalNetwork = useCallback(
    ({connectApp = false, armAutosolver = false} = {}) => {
      if (armAutosolver) {
        armRehearsalAutosolver()
      }
      getNodeBridge().startValidationDevnet(
        buildRehearsalNetworkPayload({connectApp})
      )
    },
    [armRehearsalAutosolver]
  )

  const restartRehearsalNetwork = useCallback(
    ({connectApp = true, armAutosolver = false} = {}) => {
      if (armAutosolver) {
        armRehearsalAutosolver()
      }
      getNodeBridge().restartValidationDevnet(
        buildRehearsalNetworkPayload({connectApp})
      )
    },
    [armRehearsalAutosolver]
  )

  const startAutosolveRehearsal = useCallback(() => {
    if (devnetStatus.active) {
      restartRehearsalNetwork({connectApp: true, armAutosolver: true})
    } else {
      startRehearsalNetwork({connectApp: true, armAutosolver: true})
    }
    openValidationLottery(router, {isRehearsalNodeSession: true})
  }, [
    devnetStatus.active,
    restartRehearsalNetwork,
    router,
    startRehearsalNetwork,
  ])

  const runRehearsalSolverLanes = ({
    participantCount = REHEARSAL_DEFAULT_SOLVER_PARTICIPANT_COUNT,
  } = {}) =>
    getNodeBridge().runValidationDevnetSolverLanes(
      buildRehearsalSolverLanePayload(settings.aiSolver || {}, {
        participantCount,
      })
    )

  return (
    <SettingsLayout>
      <Stack spacing={8} mt={8} w="full" maxW="5xl" minW={0}>
        <Stack spacing={4} maxW="md">
          <Stack isInline spacing={4} align="center">
            <Box>
              <Switch
                isChecked={settings.runInternalNode}
                onChange={() => {
                  clearEphemeralExternalNode()
                  getNodeBridge().clearExternalNodeOverride()
                  toggleRunInternalNode(!settings.runInternalNode)
                }}
              />
            </Box>
            <Box>
              <Text fontWeight={500}>{t('Run built-in node')}</Text>
              <Text color="muted">
                {t('Use built-in node to have automatic updates')}
              </Text>
            </Box>
            {settings.runInternalNode && nodeFailed && (
              <Box>
                <Text color="red.500">{t('Node failed to start')}</Text>
                <SecondaryButton onClick={() => tryRestartNode()}>
                  {t('Try restart')}
                </SecondaryButton>
              </Box>
            )}
          </Stack>

          {!settings.runInternalNode && (
            <Text color="muted" fontSize="sm">
              {t(
                'Built-in node is off. IdenaAI will not start or sync a local node on launch until you enable it.'
              )}
            </Text>
          )}

          {(settings.runInternalNode || settings.internalApiKey) && (
            <Stack spacing={3}>
              <SettingsFormControl>
                <SettingsFormLabel htmlFor="internal-url">
                  {t('Local built-in node address')}
                </SettingsFormLabel>
                <Box w="full" minW={0}>
                  <Input
                    id="internal-url"
                    value={`http://127.0.0.1:${settings.internalPort}`}
                    isReadOnly
                  />
                </Box>
              </SettingsFormControl>
              <SettingsFormControl>
                <SettingsFormLabel htmlFor="internal-key">
                  <Flex as="span" align="center">
                    <Box as="span">{t('Local built-in RPC key')}</Box>
                    <Box as="span" ml={2}>
                      <LocalRpcKeyHelp label={localRpcKeyHelpText} />
                    </Box>
                  </Flex>
                </SettingsFormLabel>
                <Box w="full" minW={0}>
                  <Stack isInline spacing={2} align="center">
                    <InputGroup flex={1}>
                      <Input
                        id="internal-key"
                        value={settings.internalApiKey || ''}
                        type={revealInternalApiKey ? 'text' : 'password'}
                        isReadOnly
                      />
                      <InputRightElement w="6" h="6" m="1">
                        <IconButton
                          size="xs"
                          aria-label={
                            revealInternalApiKey
                              ? t('Hide local RPC key')
                              : t('Show local RPC key')
                          }
                          icon={
                            revealInternalApiKey ? <EyeOffIcon /> : <EyeIcon />
                          }
                          bg={revealInternalApiKey ? 'gray.300' : 'white'}
                          fontSize={20}
                          _hover={{
                            bg: revealInternalApiKey ? 'gray.300' : 'white',
                          }}
                          onClick={() =>
                            setRevealInternalApiKey(!revealInternalApiKey)
                          }
                        />
                      </InputRightElement>
                    </InputGroup>
                    <SecondaryButton
                      type="button"
                      leftIcon={<CopyIcon boxSize="4" />}
                      isDisabled={!settings.internalApiKey}
                      onClick={copyLocalRpcKey}
                    >
                      {t('Copy')}
                    </SecondaryButton>
                  </Stack>
                  <Text
                    color={rehearsalNodeConnected ? 'orange.500' : 'muted'}
                    fontSize="sm"
                    mt={2}
                  >
                    {localRpcKeyStatusText}
                  </Text>
                </Box>
              </SettingsFormControl>
            </Stack>
          )}

          <Stack isInline spacing={3} align="center">
            <Box>
              <Switch
                isChecked={settings.autoActivateMining}
                isDisabled={!settings.runInternalNode}
                onChange={() => {
                  toggleAutoActivateMining()
                  getNodeBridge().restartNode()
                }}
              />
            </Box>
            <Box>
              <Text fontWeight={500}>
                {t('Activate mining status automatically')}
              </Text>
              <Text color="muted">
                {t(
                  'If your identity status is validated the mining will be activated automatically once the node is synchronized'
                )}
              </Text>
            </Box>
          </Stack>

          <HDivider />

          <Stack isInline spacing={3} align="center">
            <Box>
              <Switch
                isChecked={settings.useExternalNode}
                onChange={() => {
                  clearEphemeralExternalNode()
                  getNodeBridge().clearExternalNodeOverride()
                  toggleUseExternalNode(!settings.useExternalNode)
                }}
              />
            </Box>
            <Box>
              <Text fontWeight={500}>{t('Connect to remote node')}</Text>
              <Text color="muted">
                {t(
                  'Specify the Node address if you want to connect to remote node'
                )}
              </Text>
            </Box>
          </Stack>
        </Stack>

        {settings.useExternalNode && (
          <SettingsSection title={t('Node settings')}>
            <Stack
              spacing={3}
              as="form"
              onSubmit={(e) => {
                e.preventDefault()
                clearEphemeralExternalNode()
                getNodeBridge().clearExternalNodeOverride()
                setConnectionDetails(state)
                notify()
              }}
            >
              <SettingsFormControl>
                <SettingsFormLabel htmlFor="url">
                  {t('Node address')}
                </SettingsFormLabel>
                <Input
                  id="url"
                  value={state.url}
                  onChange={(e) =>
                    dispatch({type: 'SET_URL', data: e.target.value})
                  }
                />
              </SettingsFormControl>
              <SettingsFormControl>
                <SettingsFormLabel htmlFor="key">
                  {t('Node api key')}
                </SettingsFormLabel>
                <InputGroup>
                  <Input
                    id="key"
                    value={state.apiKey}
                    type={revealApiKey ? 'text' : 'password'}
                    onChange={(e) =>
                      dispatch({type: 'SET_API_KEY', data: e.target.value})
                    }
                  />
                  <InputRightElement w="6" h="6" m="1">
                    <IconButton
                      size="xs"
                      aria-label={
                        revealApiKey
                          ? t('Hide node API key')
                          : t('Show node API key')
                      }
                      icon={revealApiKey ? <EyeOffIcon /> : <EyeIcon />}
                      bg={revealApiKey ? 'gray.300' : 'white'}
                      fontSize={20}
                      _hover={{
                        bg: revealApiKey ? 'gray.300' : 'white',
                      }}
                      onClick={() => setRevealApiKey(!revealApiKey)}
                    />
                  </InputRightElement>
                </InputGroup>
              </SettingsFormControl>
              <Stack isInline spacing={2} align="center" justify="flex-end">
                <SecondaryButton
                  ml="auto"
                  type="button"
                  onClick={() => {
                    clearEphemeralExternalNode()
                    getNodeBridge().clearExternalNodeOverride()
                    dispatch({type: 'SET_URL', data: BASE_API_URL})
                  }}
                >
                  {t('Use default')}
                </SecondaryButton>
                <PrimaryButton type="submit">{t('Save')}</PrimaryButton>
              </Stack>
            </Stack>
          </SettingsSection>
        )}

        <SettingsSection title={t('Validation Rehearsal Devnet')} w="full">
          <Stack spacing={4} w="full" minW={0}>
            <Box>
              <Text fontWeight={500}>
                {t('Private multi-node rehearsal network')}
              </Text>
              <Text color="muted">
                {t(
                  'Start an isolated local Idena network for validation rehearsals without touching mainnet. The rehearsal network seeds FLIP-Challenge flips locally and lets the node run the normal encryption and later validation decryption flow.'
                )}
              </Text>
              <Text color="muted" mt={2}>
                {t(
                  'Current rehearsal topology: 1 shared-profile bootstrap node plus {{count}} validator identities. IdenaAI connects one primary validator for the live rehearsal session; any parallel participant work must stay rehearsal-only and must not be wired to mainnet identities.',
                  {count: REHEARSAL_NETWORK_VALIDATOR_COUNT}
                )}
              </Text>
            </Box>

            <Stack
              spacing={3}
              borderWidth="1px"
              borderColor={devnetStatus.error ? 'red.100' : 'muted'}
              borderRadius="md"
              px={4}
              py={3}
              bg={devnetStatus.error ? 'red.50' : 'transparent'}
            >
              <Text fontWeight={500}>{rehearsalStatusTitle}</Text>

              {devnetStatus.error && (
                <Text color="red.500">{devnetStatus.error}</Text>
              )}

              {rehearsalNeedsConnection && (
                <Stack spacing={1}>
                  <Text
                    color={rehearsalConnectWarning ? 'orange.500' : 'blue.500'}
                  >
                    {rehearsalConnectionMessage}
                  </Text>
                  {rehearsalCurrentNodeStatusNote && (
                    <Text color="muted">{rehearsalCurrentNodeStatusNote}</Text>
                  )}
                </Stack>
              )}

              {rehearsalSessionAlreadyAdvanced && (
                <Text color="orange.500">
                  {t(
                    'This rehearsal node is already inside {{period}}. Restart the rehearsal network for a clean short-session run.',
                    {period: rehearsalCurrentPeriod}
                  )}
                </Text>
              )}

              {(devnetStatus.networkId || devnetStatus.firstCeremonyAt) && (
                <Stack spacing={1}>
                  {devnetStatus.networkId && (
                    <Text color="muted">
                      {t('Network id')}: {devnetStatus.networkId}
                    </Text>
                  )}
                  {devnetStatus.firstCeremonyAt && (
                    <Text color="muted">
                      {t('First ceremony starts at')}:{' '}
                      {devnetStatus.firstCeremonyAt}
                    </Text>
                  )}
                  {typeof devnetStatus.countdownSeconds === 'number' && (
                    <Text color="muted">
                      {t('Countdown')}: {devnetStatus.countdownSeconds}
                      {t(' sec')}
                    </Text>
                  )}
                  {rehearsalCurrentPeriod && (
                    <Text color="muted">
                      {t('Primary node period')}: {rehearsalCurrentPeriod}
                    </Text>
                  )}
                  {devnetStatus.primaryRpcUrl && (
                    <Text color="muted">
                      {t('Primary RPC endpoint')}: {devnetStatus.primaryRpcUrl}
                    </Text>
                  )}
                  {devnetStatus.seedSource && (
                    <Text color="muted">
                      {t('Seed source')}: {devnetStatus.seedSource}
                    </Text>
                  )}
                  {typeof devnetStatus.seedSubmittedCount === 'number' && (
                    <Text color="muted">
                      {t('Seed flips')}: {devnetStatus.seedSubmittedCount}
                      {typeof devnetStatus.seedRequestedCount === 'number'
                        ? ` / ${devnetStatus.seedRequestedCount}`
                        : ''}
                    </Text>
                  )}
                  {typeof devnetStatus.seedConfirmedCount === 'number' && (
                    <Text color="muted">
                      {t('Confirmed flips on primary node')}:{' '}
                      {devnetStatus.seedConfirmedCount}
                    </Text>
                  )}
                  {typeof devnetStatus.primaryShortHashCount === 'number' && (
                    <Text color="muted">
                      {t('Assigned short-session flips on primary node')}:{' '}
                      {devnetStatus.primaryShortHashCount}
                      {typeof devnetStatus.primaryShortHashReadyCount ===
                      'number'
                        ? ` (${devnetStatus.primaryShortHashReadyCount} ready now)`
                        : ''}
                    </Text>
                  )}
                  {typeof devnetStatus.primaryLongHashCount === 'number' && (
                    <Text color="muted">
                      {t('Assigned long-session flips on primary node')}:{' '}
                      {devnetStatus.primaryLongHashCount}
                      {typeof devnetStatus.primaryLongHashReadyCount ===
                      'number'
                        ? ` (${devnetStatus.primaryLongHashReadyCount} ready now)`
                        : ''}
                    </Text>
                  )}
                  {devnetStatus.nodes.length > 0 && (
                    <Text color="muted">
                      {t('Ready nodes')}: {readyDevnetNodeCount} /{' '}
                      {devnetStatus.nodeCount}
                    </Text>
                  )}
                  {devnetStatus.nodes.length > 0 && (
                    <Text color="muted">
                      {t('Online nodes')}: {onlineDevnetNodeCount} /{' '}
                      {devnetStatus.nodeCount}
                    </Text>
                  )}
                  {devnetStatus.nodes.length > 0 && (
                    <Text color="muted">
                      {t('Rehearsal validator identities')}:{' '}
                      {
                        devnetStatus.nodes.filter(
                          ({role}) => role === 'validator'
                        ).length
                      }
                    </Text>
                  )}
                  {canShowDevnetAssignmentSummary && (
                    <Stack spacing={1}>
                      <Text color="muted">
                        {t('Nodes with assigned validation hashes')}:{' '}
                        {assignedDevnetNodeCount} / {devnetStatus.nodeCount}
                      </Text>
                      <Text color="muted" fontSize="sm">
                        {devnetStatus.nodes
                          .map(formatRehearsalNodeAssignment)
                          .join(' | ')}
                      </Text>
                    </Stack>
                  )}
                  {rehearsalNodeConnected && !rehearsalNodeRpcUnavailable && (
                    <Stack spacing={1}>
                      <Text
                        color={
                          rehearsalNodeRpcPending ? 'orange.500' : 'green.500'
                        }
                      >
                        {t(
                          rehearsalNodeRpcPending
                            ? 'IdenaAI selected the rehearsal node, but the app status is still refreshing.'
                            : 'IdenaAI is currently connected to the rehearsal network for this app session.'
                        )}
                      </Text>
                      {rehearsalNodeRpcPending && (
                        <Text color="muted">
                          {t(
                            'The rehearsal RPC is ready. Wait a moment or open the countdown; if the sidebar stays offline, restart the clean autosolve rehearsal.'
                          )}
                        </Text>
                      )}
                      {rehearsalAutosolverArmed ? (
                        <Text color="green.500">
                          {t(
                            'Rehearsal autosolver is armed. The app will open validation and run the AI solver when the rehearsal session starts.'
                          )}
                        </Text>
                      ) : (
                        <Text color="orange.500">
                          {rehearsalAutosolverManualOnly
                            ? t(
                                'Manual AI helper is enabled, but rehearsal autosolve is not armed. It will not start or submit by itself.'
                              )
                            : t(
                                'Rehearsal autosolve is not armed. Enable it before the countdown reaches short session.'
                              )}
                        </Text>
                      )}
                      {rehearsalSessionMessage && (
                        <Text
                          color={
                            rehearsalValidationOpenable
                              ? 'green.500'
                              : 'orange.500'
                          }
                        >
                          {rehearsalSessionMessage}
                        </Text>
                      )}
                    </Stack>
                  )}
                  {rehearsalNodeRpcUnavailable && (
                    <Stack spacing={1}>
                      <Text color="red.500">
                        {t(
                          'IdenaAI selected the rehearsal node for this app session, but the rehearsal RPC is currently offline or unreachable.'
                        )}
                      </Text>
                      <Text color="muted">
                        {t(
                          'The sidebar status is based on live RPC checks. If it shows Offline here, the rehearsal node is not reachable right now even if the last devnet snapshot still looked healthy.'
                        )}
                      </Text>
                    </Stack>
                  )}
                </Stack>
              )}

              <Flex
                align="center"
                gap={2}
                flexWrap="wrap"
                maxW="full"
                minW={0}
                sx={{
                  '& button': {
                    whiteSpace: 'normal',
                  },
                }}
              >
                {!devnetStatus.active ? (
                  <>
                    <PrimaryButton
                      onClick={startAutosolveRehearsal}
                      isLoading={isStartingDevnet}
                      isDisabled={!canUseIpcRenderer || isStartingDevnet}
                    >
                      {t('Start autosolve rehearsal')}
                    </PrimaryButton>

                    <SecondaryButton
                      onClick={() => startRehearsalNetwork({connectApp: true})}
                      isLoading={isStartingDevnet}
                      isDisabled={!canUseIpcRenderer || isStartingDevnet}
                    >
                      {t('Start and use rehearsal network')}
                    </SecondaryButton>

                    <SecondaryButton
                      onClick={() => startRehearsalNetwork()}
                      isDisabled={!canUseIpcRenderer || isStartingDevnet}
                    >
                      {t('Start in background')}
                    </SecondaryButton>
                  </>
                ) : (
                  <>
                    {rehearsalCanOpenCountdown && (
                      <PrimaryButton
                        onClick={() =>
                          openValidationLottery(router, {
                            isRehearsalNodeSession: rehearsalNodeConnected,
                          })
                        }
                        isDisabled={!canUseIpcRenderer}
                      >
                        {t('Open countdown')}
                      </PrimaryButton>
                    )}

                    {rehearsalNodeConnected &&
                      rehearsalCurrentPeriod === 'ShortSession' &&
                      rehearsalValidationOpenable && (
                        <PrimaryButton
                          onClick={() => router.push('/validation')}
                          isDisabled={!canUseIpcRenderer}
                        >
                          {t('Open validation')}
                        </PrimaryButton>
                      )}

                    {rehearsalNodeConnected &&
                      rehearsalCurrentPeriod === 'LongSession' &&
                      rehearsalValidationOpenable && (
                        <PrimaryButton
                          onClick={() => router.push('/validation')}
                          isDisabled={!canUseIpcRenderer}
                        >
                          {t('Open validation')}
                        </PrimaryButton>
                      )}

                    {rehearsalNodeConnected &&
                      ['ShortSession', 'LongSession'].includes(
                        rehearsalCurrentPeriod
                      ) &&
                      !rehearsalValidationOpenable &&
                      rehearsalBlockedReason !== 'failed-rehearsal' && (
                        <PrimaryButton
                          onClick={() => {
                            const nextPath = getRehearsalValidationEntryPath({
                              blockedReason: rehearsalBlockedReason,
                              canOpenValidation: rehearsalValidationOpenable,
                            })

                            if (nextPath === '/validation/lottery') {
                              openValidationLottery(router, {
                                isRehearsalNodeSession: rehearsalNodeConnected,
                              })
                              return
                            }

                            router.push(nextPath)
                          }}
                          isDisabled={!canUseIpcRenderer}
                        >
                          {t('Open session status')}
                        </PrimaryButton>
                      )}

                    {rehearsalNodeConnected &&
                      rehearsalCurrentPeriod === 'AfterLongSession' && (
                        <PrimaryButton
                          onClick={() => router.push('/validation/after')}
                          isDisabled={!canUseIpcRenderer}
                        >
                          {t('Open results')}
                        </PrimaryButton>
                      )}

                    {rehearsalNodeConnected && !rehearsalAutosolverArmed && (
                      <PrimaryButton
                        onClick={armRehearsalAutosolver}
                        isDisabled={!canUseIpcRenderer}
                      >
                        {t('Arm rehearsal autosolver')}
                      </PrimaryButton>
                    )}

                    {(rehearsalSessionAlreadyAdvanced ||
                      !rehearsalAutosolverArmed) && (
                      <PrimaryButton
                        onClick={startAutosolveRehearsal}
                        isDisabled={!canUseIpcRenderer || isStartingDevnet}
                        isLoading={isStartingDevnet}
                      >
                        {t('Restart autosolve rehearsal')}
                      </PrimaryButton>
                    )}

                    {rehearsalNeedsConnection && (
                      <PrimaryButton
                        onClick={() =>
                          getNodeBridge().connectValidationDevnet()
                        }
                        isDisabled={
                          !canUseIpcRenderer || !rehearsalNodeConnectable
                        }
                      >
                        {t('Use rehearsal node now')}
                      </PrimaryButton>
                    )}

                    <SecondaryButton
                      onClick={() =>
                        restartRehearsalNetwork({
                          connectApp:
                            rehearsalNodeConnected || rehearsalNeedsConnection,
                        })
                      }
                      isDisabled={!canUseIpcRenderer || isStartingDevnet}
                    >
                      {t('Restart fresh rehearsal')}
                    </SecondaryButton>

                    <SecondaryButton
                      onClick={() => runRehearsalSolverLanes()}
                      isDisabled={
                        !canUseIpcRenderer ||
                        !canRunRehearsalSolverLanes ||
                        rehearsalSolverLaneRunning
                      }
                    >
                      {rehearsalSolverLaneRunning
                        ? t('Running rehearsal')
                        : t('Run 1-ID rehearsal')}
                    </SecondaryButton>

                    <SecondaryButton
                      onClick={() =>
                        runRehearsalSolverLanes({
                          participantCount: REHEARSAL_NETWORK_VALIDATOR_COUNT,
                        })
                      }
                      isDisabled={
                        !canUseIpcRenderer ||
                        !canRunRehearsalSolverLanes ||
                        rehearsalSolverLaneRunning
                      }
                    >
                      {t('Run 9-ID rehearsal')}
                    </SecondaryButton>

                    <SecondaryButton
                      onClick={() => getNodeBridge().stopValidationDevnet()}
                      isDisabled={!canUseIpcRenderer || !devnetStatus.active}
                    >
                      {t('Stop rehearsal network')}
                    </SecondaryButton>
                  </>
                )}
              </Flex>

              {rehearsalSolverLanes && (
                <Stack
                  spacing={3}
                  borderWidth="1px"
                  borderColor="muted"
                  borderRadius="md"
                  px={3}
                  py={3}
                >
                  <Stack spacing={1}>
                    <Text fontWeight={500}>
                      {rehearsalSolverIsParallel
                        ? t('Shared-node participant rehearsal')
                        : t('Single-identity rehearsal autosolve')}
                    </Text>
                    <Text color="muted" fontSize="sm">
                      {rehearsalSolverIsParallel
                        ? t(
                            'Optional rehearsal-only dry run. It uses the current AI provider key in the main process, staggers participant request starts, records compact telemetry, and does not submit answers or touch mainnet identities.'
                          )
                        : t(
                            'Default rehearsal-only dry run. It uses the current AI provider key for one local rehearsal identity, records compact telemetry, and does not submit answers or touch mainnet identities.'
                          )}
                    </Text>
                    <Text color="muted" fontSize="sm">
                      {t('Provider')}: {rehearsalSolverLanes.provider || '-'}{' '}
                      {t('Model')}: {rehearsalSolverLanes.model || '-'}
                    </Text>
                    {typeof rehearsalSolverLanes.laneStartDelayMs ===
                      'number' && (
                      <Text color="muted" fontSize="sm">
                        {t('Participant start delay')}:{' '}
                        {rehearsalSolverLanes.laneStartDelayMs}
                        {t(' ms')}
                      </Text>
                    )}
                  </Stack>

                  {rehearsalSolverLaneSummary && (
                    <Flex flexWrap="wrap" gridGap={3}>
                      <Box>
                        <Text color="muted" fontSize="sm">
                          {t('Solved')}
                        </Text>
                        <Text fontWeight={500}>
                          {rehearsalSolverLaneSummary.solved || 0}
                        </Text>
                      </Box>
                      <Box>
                        <Text color="muted" fontSize="sm">
                          {t('Skipped')}
                        </Text>
                        <Text fontWeight={500}>
                          {rehearsalSolverLaneSummary.skipped || 0}
                        </Text>
                      </Box>
                      <Box>
                        <Text color="muted" fontSize="sm">
                          {t('Errors')}
                        </Text>
                        <Text fontWeight={500}>
                          {rehearsalSolverLaneSummary.errors || 0}
                        </Text>
                      </Box>
                      <Box>
                        <Text color="muted" fontSize="sm">
                          {t('Left / right')}
                        </Text>
                        <Text fontWeight={500}>
                          {rehearsalSolverLaneSummary.left || 0} /{' '}
                          {rehearsalSolverLaneSummary.right || 0}
                        </Text>
                      </Box>
                      <Box>
                        <Text color="muted" fontSize="sm">
                          {t('Tokens')}
                        </Text>
                        <Text fontWeight={500}>
                          {formatRehearsalSolverTokenCount(
                            rehearsalSolverLaneSummary.tokens?.totalTokens
                          )}
                        </Text>
                      </Box>
                      <Box>
                        <Text color="muted" fontSize="sm">
                          {t('Cost')}
                        </Text>
                        <Text fontWeight={500}>
                          {formatRehearsalSolverUsd(
                            rehearsalSolverLaneSummary.costs?.actualUsd ??
                              rehearsalSolverLaneSummary.costs?.estimatedUsd
                          )}
                        </Text>
                      </Box>
                    </Flex>
                  )}

                  {Array.isArray(rehearsalSolverLanes.lanes) &&
                    rehearsalSolverLanes.lanes.length > 0 && (
                      <Stack spacing={1}>
                        {rehearsalSolverLanes.lanes
                          .slice(0, REHEARSAL_NETWORK_VALIDATOR_COUNT)
                          .map((lane) => (
                            <Text
                              key={lane.nodeName || lane.lane}
                              color={lane.error ? 'red.500' : 'muted'}
                              fontSize="sm"
                            >
                              {lane.nodeName || `lane-${lane.lane}`}:{' '}
                              {lane.participantLabel
                                ? `${lane.participantLabel}, `
                                : ''}
                              {lane.status}
                              {lane.session ? `, ${lane.session}` : ''}
                              {typeof lane.flipCount === 'number'
                                ? `, ${lane.flipCount} flips`
                                : ''}
                              {lane.summary
                                ? `, solved ${
                                    lane.summary.solved || 0
                                  }, errors ${lane.summary.errors || 0}`
                                : ''}
                              {lane.error ? `, ${lane.error}` : ''}
                            </Text>
                          ))}
                      </Stack>
                    )}
                </Stack>
              )}
            </Stack>

            <Box w="full" minW={0}>
              <Heading fontWeight={500} fontSize="md" mb={3}>
                {t('Rehearsal network log')}
              </Heading>
              <Flex
                direction="column"
                height="xs"
                overflow="auto"
                wordBreak="break-word"
                maxW="full"
                borderColor="muted"
                borderWidth="px"
                fontSize="sm"
                fontFamily="mono"
                px={3}
                py={2}
                sx={{
                  '& span': {
                    whiteSpace: 'pre-wrap',
                    overflowWrap: 'anywhere',
                  },
                }}
              >
                {state.devnetLogs.length > 0 ? (
                  state.devnetLogs.map((log, idx) => (
                    <Ansi key={idx}>{log}</Ansi>
                  ))
                ) : (
                  <Text color="muted">{emptyDevnetLogMessage}</Text>
                )}
              </Flex>
            </Box>
          </Stack>
        </SettingsSection>

        {!settings.useExternalNode && (
          <Box w="full" minW={0}>
            <Heading fontWeight={500} fontSize="lg" mb={4}>
              {t('Built-in node log')}
            </Heading>
            <Flex
              ref={logsRef}
              direction="column"
              height="xs"
              overflow="auto"
              wordBreak="break-word"
              maxW="full"
              borderColor="muted"
              borderWidth="px"
              fontSize="sm"
              fontFamily="mono"
              px={3}
              py={2}
              sx={{
                '& span': {
                  whiteSpace: 'pre-wrap',
                  overflowWrap: 'anywhere',
                },
              }}
            >
              {state.logs.length > 0 ? (
                state.logs.map((log, idx) => <Ansi key={idx}>{log}</Ansi>)
              ) : (
                <Text color="muted">{emptyLogMessage}</Text>
              )}
            </Flex>
          </Box>
        )}
      </Stack>
    </SettingsLayout>
  )
}

export default NodeSettings
