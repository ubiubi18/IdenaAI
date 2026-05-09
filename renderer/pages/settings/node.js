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
import {AiProviderBudgetCapDialog} from '../../shared/components/ai-provider-budget-cap-dialog'
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
  Dialog,
  DialogBody,
  DialogFooter,
  HDivider,
  Input,
  Select,
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
import {buildLocalAiRuntimePayload} from '../../shared/utils/ai-provider-readiness'
import {shouldBlockSessionAutoInDev} from '../../shared/utils/validation-ai-auto'
import {
  appendAiProviderBudgetLedgerEntry,
  buildAiProviderDailyBudgetErrorMessage,
  getAiProviderDailyBudgetStatus,
} from '../../shared/utils/ai-provider-budget'

const NODE_SETTINGS_TOAST_ID = 'node-settings-status-toast'
const LOCAL_RPC_KEY_TOAST_ID = 'local-rpc-key-toast'
const REHEARSAL_AI_TOAST_ID = 'rehearsal-ai-setup-toast'
const APP_NAME = 'IdenaAI'

const REHEARSAL_AI_SETUP_MODES = {
  Remote: 'remote',
  Local: 'local',
  None: 'none',
}

const AI_SETUP_TARGETS = {
  Rehearsal: 'rehearsal',
  Real: 'real',
}

const REHEARSAL_AI_PROVIDER_OPTIONS = [
  {value: 'openai', label: 'OpenAI'},
  {value: 'anthropic', label: 'Anthropic Claude'},
  {value: 'gemini', label: 'Google Gemini'},
  {value: 'xai', label: 'xAI (Grok)'},
  {value: 'mistral', label: 'Mistral'},
  {value: 'groq', label: 'Groq'},
  {value: 'deepseek', label: 'DeepSeek'},
  {value: 'openrouter', label: 'OpenRouter'},
  {value: 'openai-compatible', label: 'OpenAI-compatible (custom)'},
]

const REHEARSAL_AI_DEFAULT_MODELS = {
  openai: 'gpt-5.5',
  anthropic: 'claude-3-7-sonnet-latest',
  gemini: 'gemini-2.0-flash',
  xai: 'grok-2-vision-latest',
  mistral: 'mistral-large-latest',
  groq: 'llama-3.2-90b-vision-preview',
  deepseek: 'deepseek-chat',
  openrouter: 'openai/gpt-4o-mini',
  'openai-compatible': 'gpt-5.5',
}

const REHEARSAL_AI_MODEL_PRESETS = {
  openai: [
    'gpt-5.5',
    'gpt-5.5-mini',
    'gpt-5.4',
    'gpt-5.4-mini',
    'gpt-5.3-chat-latest',
    'gpt-5.3-codex',
    'gpt-5-mini',
    'gpt-4.1',
    'gpt-4.1-mini',
    'gpt-4o',
    'gpt-4o-mini',
    'o4-mini',
  ],
  anthropic: [
    'claude-3-7-sonnet-latest',
    'claude-3-5-sonnet-latest',
    'claude-3-5-haiku-latest',
  ],
  gemini: ['gemini-2.0-flash', 'gemini-1.5-pro', 'gemini-1.5-flash'],
  xai: ['grok-2-vision-latest', 'grok-2-latest'],
  mistral: ['mistral-large-latest', 'pixtral-large-latest', 'pixtral-12b'],
  groq: [
    'llama-3.2-90b-vision-preview',
    'meta-llama/llama-4-scout-17b-16e-instruct',
  ],
  deepseek: ['deepseek-chat', 'deepseek-reasoner'],
  openrouter: [
    'openai/gpt-4o-mini',
    'openai/gpt-4.1-mini',
    'anthropic/claude-3.7-sonnet',
    'google/gemini-2.0-flash-001',
  ],
  'openai-compatible': [
    'gpt-5.5',
    'gpt-5.5-mini',
    'gpt-5.4',
    'gpt-5.4-mini',
    'gpt-4.1-mini',
    'gpt-4o-mini',
  ],
}

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

function getAiSolverBridge() {
  if (!global.aiSolver) {
    throw new Error('AI bridge is not available in this build')
  }

  return global.aiSolver
}

function getLocalAiBridge() {
  if (!global.localAi) {
    throw new Error('Local AI bridge is not available in this build')
  }

  return global.localAi
}

function resolveRehearsalAiSetupMode(aiSolver = {}) {
  return aiSolver?.provider === 'local-ai'
    ? REHEARSAL_AI_SETUP_MODES.Local
    : REHEARSAL_AI_SETUP_MODES.Remote
}

function resolveRehearsalAiProvider(aiSolver = {}) {
  const configuredProvider = String(aiSolver.provider || '').trim()

  return REHEARSAL_AI_PROVIDER_OPTIONS.some(
    ({value}) => value === configuredProvider
  )
    ? configuredProvider
    : 'openai'
}

function resolveRehearsalAiModel(provider, model = '') {
  const value = String(model || '').trim()

  return value || REHEARSAL_AI_DEFAULT_MODELS[provider] || 'gpt-5.5'
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
    model: aiSolver.model || 'gpt-5.5',
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
      seedConfirmedNodeCount: null,
      seedExpectedNodeCount: null,
      seedPrimaryVisibleNodeCount: null,
      seedPrimaryExpectedNodeCount: null,
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
    seedConfirmedNodeCount:
      typeof value.seedConfirmedNodeCount === 'number'
        ? value.seedConfirmedNodeCount
        : null,
    seedExpectedNodeCount:
      typeof value.seedExpectedNodeCount === 'number'
        ? value.seedExpectedNodeCount
        : null,
    seedPrimaryVisibleNodeCount:
      typeof value.seedPrimaryVisibleNodeCount === 'number'
        ? value.seedPrimaryVisibleNodeCount
        : null,
    seedPrimaryExpectedNodeCount:
      typeof value.seedPrimaryExpectedNodeCount === 'number'
        ? value.seedPrimaryExpectedNodeCount
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
    updateLocalAiSettings,
  } = useSettingsDispatch()

  const {nodeFailed} = useNodeState()
  const {offline: chainOffline} = useChainState()

  const {tryRestartNode} = useNodeDispatch()

  const logsRef = useRef(null)
  const canUseIpcRenderer = hasNodeBridge()
  const isRealSessionAutoBlockedInDev = shouldBlockSessionAutoInDev({
    isDev: global.isDev,
    allowDevSessionAuto:
      String(global.env?.IDENA_DESKTOP_ALLOW_DEV_SESSION_AUTO || '').trim() ===
      '1',
    forceAiPreview: false,
    isRehearsalNodeSession: false,
  })

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
  const [isRehearsalAiDialogOpen, setIsRehearsalAiDialogOpen] = useState(false)
  const [isPreparingRehearsalAi, setIsPreparingRehearsalAi] = useState(false)
  const [aiSetupTarget, setAiSetupTarget] = useState(AI_SETUP_TARGETS.Rehearsal)
  const [rehearsalAiSetupMode, setRehearsalAiSetupMode] = useState(() =>
    resolveRehearsalAiSetupMode(settings.aiSolver)
  )
  const [rehearsalAiProvider, setRehearsalAiProvider] = useState(() =>
    resolveRehearsalAiProvider(settings.aiSolver)
  )
  const [rehearsalAiModel, setRehearsalAiModel] = useState(() =>
    resolveRehearsalAiModel(
      resolveRehearsalAiProvider(settings.aiSolver),
      settings.aiSolver?.model
    )
  )
  const [rehearsalApiKey, setRehearsalApiKey] = useState('')
  const [isRehearsalApiKeyVisible, setIsRehearsalApiKeyVisible] =
    useState(false)
  const [isProviderBudgetCapDialogOpen, setIsProviderBudgetCapDialogOpen] =
    useState(false)
  const [providerBudgetCapDialogStatus, setProviderBudgetCapDialogStatus] =
    useState(null)
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
  const connectedDevnetNodeCount = devnetStatus.nodes.filter(
    ({peerCount}) => Number(peerCount) > 0
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
  const rehearsalAiModelPresets =
    REHEARSAL_AI_MODEL_PRESETS[rehearsalAiProvider] || []
  const rehearsalAiModelPresetValue = rehearsalAiModelPresets.includes(
    rehearsalAiModel
  )
    ? rehearsalAiModel
    : 'custom'
  const trimmedRehearsalApiKey = String(rehearsalApiKey || '').trim()
  const isRehearsalRemoteAiMode =
    rehearsalAiSetupMode === REHEARSAL_AI_SETUP_MODES.Remote
  const isRehearsalLocalAiMode =
    rehearsalAiSetupMode === REHEARSAL_AI_SETUP_MODES.Local
  const isRehearsalNoAiMode =
    rehearsalAiSetupMode === REHEARSAL_AI_SETUP_MODES.None
  const isRealAutosolverDialog = aiSetupTarget === AI_SETUP_TARGETS.Real
  const realAutosolverArmed =
    settings.aiSolver?.enabled === true &&
    String(settings.aiSolver?.mode || '').trim() === 'session-auto' &&
    Boolean(String(settings.aiSolver?.onchainAutoSubmitConsentAt || '').trim())
  const rehearsalAiProviderLabel =
    REHEARSAL_AI_PROVIDER_OPTIONS.find(
      ({value}) => value === rehearsalAiProvider
    )?.label || rehearsalAiProvider
  const providerDailyBudgetStatus = getAiProviderDailyBudgetStatus(
    settings.aiSolver || {}
  )
  const rehearsalDialogBudgetStatus = getAiProviderDailyBudgetStatus(
    {
      ...(settings.aiSolver || {}),
      provider: rehearsalAiProvider,
      model: rehearsalAiModel,
    },
    {provider: rehearsalAiProvider}
  )
  const providerDailyBudgetUsageText = t(
    'Today: {{spent}} used of {{limit}} local daily cap',
    {
      spent: formatRehearsalSolverUsd(providerDailyBudgetStatus.usage.usd),
      limit: formatRehearsalSolverUsd(providerDailyBudgetStatus.limitUsd),
    }
  )
  const rehearsalDialogBudgetUsageText = t(
    'Today: {{spent}} used of {{limit}} local daily cap',
    {
      spent: formatRehearsalSolverUsd(rehearsalDialogBudgetStatus.usage.usd),
      limit: formatRehearsalSolverUsd(rehearsalDialogBudgetStatus.limitUsd),
    }
  )
  let providerDailyBudgetNodeText = t(
    'Daily API guardrail is active. {{usage}}.',
    {
      usage: providerDailyBudgetUsageText,
    }
  )
  if (providerDailyBudgetStatus.blocked) {
    providerDailyBudgetNodeText = t(
      'Daily API guardrail is blocking remote-provider autosolve. {{usage}}. Approve a higher cap before continuing.',
      {usage: providerDailyBudgetUsageText}
    )
  }
  let rehearsalDialogBudgetText = t(
    'Remote provider starts are capped by default. {{usage}}.',
    {usage: rehearsalDialogBudgetUsageText}
  )
  if (rehearsalDialogBudgetStatus.blocked) {
    rehearsalDialogBudgetText = t(
      'Remote provider starts are blocked for today. {{usage}}.',
      {usage: rehearsalDialogBudgetUsageText}
    )
  }
  const remoteRehearsalBudgetBlocked =
    providerDailyBudgetStatus.blocked &&
    settings.aiSolver?.provider !== 'local-ai'
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

  const showRehearsalAiToast = useCallback(
    (title, description, status = 'info') => {
      if (
        typeof toast.isActive === 'function' &&
        typeof toast.close === 'function' &&
        toast.isActive(REHEARSAL_AI_TOAST_ID)
      ) {
        toast.close(REHEARSAL_AI_TOAST_ID)
      }

      toast({
        id: REHEARSAL_AI_TOAST_ID,
        duration: 7000,
        render: () => (
          <Toast title={title} description={description} status={status} />
        ),
      })
    },
    [toast]
  )

  const openProviderBudgetCapDialog = useCallback((status = null) => {
    setProviderBudgetCapDialogStatus(status)
    setIsProviderBudgetCapDialogOpen(true)
  }, [])

  const approveProviderDailyBudgetCap = useCallback(
    (nextCapUsd) => {
      const normalizedCapUsd = Number(nextCapUsd)
      if (!Number.isFinite(normalizedCapUsd) || normalizedCapUsd <= 0) {
        return
      }

      updateAiSolverSettings({
        providerDailyBudgetEnabled: true,
        providerDailyBudgetUsd: normalizedCapUsd,
        providerDailyBudgetOverrideDate: '',
        providerDailyBudgetOverrideConsentAt: '',
        providerDailyBudgetLastApprovedUsd: normalizedCapUsd,
        providerDailyBudgetLastApprovedAt: new Date().toISOString(),
      })
      setIsProviderBudgetCapDialogOpen(false)
      setProviderBudgetCapDialogStatus(null)
      showRehearsalAiToast(
        t('Daily API budget cap raised'),
        t(
          'Remote-provider AI calls can continue until the newly approved local cap is reached. Keep watching provider-side limits.'
        ),
        'warning'
      )
    },
    [showRehearsalAiToast, t, updateAiSolverSettings]
  )

  const openProviderBudgetCapApproval = useCallback(() => {
    updateAiSolverSettings({
      providerDailyBudgetEnabled: true,
      providerDailyBudgetOverrideDate: '',
      providerDailyBudgetOverrideConsentAt: '',
    })
    openProviderBudgetCapDialog(rehearsalDialogBudgetStatus)
  }, [
    openProviderBudgetCapDialog,
    rehearsalDialogBudgetStatus,
    updateAiSolverSettings,
  ])

  const handleProviderBudgetError = useCallback(
    (error) => {
      const status = error && error.budgetStatus
      if (status) {
        openProviderBudgetCapDialog(status)
      }
    },
    [openProviderBudgetCapDialog]
  )

  const assertRemoteProviderBudgetAvailable = useCallback((aiSolver = {}) => {
    const status = getAiProviderDailyBudgetStatus(aiSolver)
    if (status.blocked) {
      const error = new Error(buildAiProviderDailyBudgetErrorMessage(status))
      error.code = 'provider_budget_exceeded'
      error.budgetStatus = status
      throw error
    }
    return status
  }, [])

  const resetAiSetupDialogState = useCallback(() => {
    const provider = 'openai'
    setRehearsalAiSetupMode(resolveRehearsalAiSetupMode(settings.aiSolver))
    setRehearsalAiProvider(provider)
    setRehearsalAiModel(resolveRehearsalAiModel(provider))
    setRehearsalApiKey('')
    setIsRehearsalApiKeyVisible(false)
  }, [settings.aiSolver])

  const openRehearsalAiDialog = useCallback(() => {
    resetAiSetupDialogState()
    setAiSetupTarget(AI_SETUP_TARGETS.Rehearsal)
    setIsRehearsalAiDialogOpen(true)
  }, [resetAiSetupDialogState])

  const openRealAutosolverDialog = useCallback(() => {
    if (isRealSessionAutoBlockedInDev) {
      showRehearsalAiToast(
        t('Automatic session solving is blocked in dev mode'),
        t(
          'For real validation from Terminal, restart with IDENA_DESKTOP_USER_DATA_DIR pointed at the real app profile and IDENA_DESKTOP_ALLOW_DEV_SESSION_AUTO=1.'
        ),
        'warning'
      )
      return
    }

    resetAiSetupDialogState()
    setAiSetupTarget(AI_SETUP_TARGETS.Real)
    setIsRehearsalAiDialogOpen(true)
  }, [
    isRealSessionAutoBlockedInDev,
    resetAiSetupDialogState,
    showRehearsalAiToast,
    t,
  ])

  const closeRehearsalAiDialog = useCallback(() => {
    if (!isPreparingRehearsalAi) {
      setIsRehearsalAiDialogOpen(false)
    }
  }, [isPreparingRehearsalAi])

  const updateRehearsalAiProvider = useCallback((provider) => {
    const nextProvider = resolveRehearsalAiProvider({provider})
    setRehearsalAiProvider(nextProvider)
    setRehearsalAiModel(resolveRehearsalAiModel(nextProvider))
  }, [])

  const startRehearsalNetworkForDialog = useCallback(
    ({armAutosolver = false} = {}) => {
      if (devnetStatus.active) {
        restartRehearsalNetwork({connectApp: true, armAutosolver})
      } else {
        startRehearsalNetwork({connectApp: true, armAutosolver})
      }
    },
    [devnetStatus.active, restartRehearsalNetwork, startRehearsalNetwork]
  )

  const startRehearsalWithoutAi = useCallback(async () => {
    setIsPreparingRehearsalAi(true)

    try {
      updateAiSolverSettings({
        enabled: false,
        mode: 'manual',
        onchainAutoSubmitConsentAt: '',
      })

      startRehearsalNetworkForDialog()
      setIsRehearsalAiDialogOpen(false)
      showRehearsalAiToast(
        t('Rehearsal started without AI'),
        t(
          'The rehearsal network is connected to this app, but autosolver mode is off. You can arm AI later from this page before the short session starts.'
        ),
        'info'
      )
    } catch (error) {
      showRehearsalAiToast(
        t('Unable to start rehearsal'),
        String((error && error.message) || error || '').trim() ||
          t('Unknown rehearsal setup error'),
        'error'
      )
    } finally {
      setIsPreparingRehearsalAi(false)
    }
  }, [
    showRehearsalAiToast,
    startRehearsalNetworkForDialog,
    t,
    updateAiSolverSettings,
  ])

  const startAutosolveRehearsalWithLocalAi = useCallback(async () => {
    setIsPreparingRehearsalAi(true)

    try {
      const nextLocalAi = {
        ...(settings.localAi || {}),
        enabled: true,
      }
      const runtimePayload = buildLocalAiRuntimePayload(nextLocalAi)

      updateLocalAiSettings({enabled: true})
      updateAiSolverSettings({
        enabled: true,
        mode: 'session-auto',
        provider: 'local-ai',
      })

      await getLocalAiBridge().start(runtimePayload)

      startRehearsalNetworkForDialog({armAutosolver: true})
      setIsRehearsalAiDialogOpen(false)
      showRehearsalAiToast(
        t('Rehearsal autosolver armed with Local AI'),
        t(
          'Local AI mode is enabled without a provider API key. This page will keep showing node stats and logs until you open the countdown or validation manually.'
        ),
        'success'
      )
    } catch (error) {
      showRehearsalAiToast(
        t('Unable to start Local AI'),
        String((error && error.message) || error || '').trim() ||
          t('Unknown local AI setup error'),
        'error'
      )
    } finally {
      setIsPreparingRehearsalAi(false)
    }
  }, [
    settings.localAi,
    showRehearsalAiToast,
    startRehearsalNetworkForDialog,
    t,
    updateAiSolverSettings,
    updateLocalAiSettings,
  ])

  const startAutosolveRehearsalWithAi = useCallback(
    async ({loadApiKey = false} = {}) => {
      const provider = resolveRehearsalAiProvider({
        provider: rehearsalAiProvider,
      })
      const model = resolveRehearsalAiModel(provider, rehearsalAiModel)

      setIsPreparingRehearsalAi(true)

      try {
        assertRemoteProviderBudgetAvailable({
          ...(settings.aiSolver || {}),
          provider,
          model,
        })

        if (loadApiKey) {
          await getAiSolverBridge().setProviderKey({
            provider,
            apiKey: trimmedRehearsalApiKey,
          })
          setRehearsalApiKey('')
          setIsRehearsalApiKeyVisible(false)
        }

        updateAiSolverSettings(
          loadApiKey
            ? {
                enabled: true,
                mode: 'session-auto',
                provider,
                model,
              }
            : {
                enabled: true,
                mode: 'session-auto',
              }
        )

        startRehearsalNetworkForDialog({armAutosolver: true})

        setIsRehearsalAiDialogOpen(false)
        showRehearsalAiToast(
          t('Rehearsal autosolver armed'),
          loadApiKey
            ? t(
                '{{provider}} {{model}} key loaded. Autosolver mode is enabled for the rehearsal session; this page will keep showing node stats and logs until you open the countdown or validation manually.',
                {
                  provider: rehearsalAiProviderLabel,
                  model,
                }
              )
            : t(
                'Autosolver mode is enabled with the already configured AI settings. This page will keep showing node stats and logs until you open the countdown or validation manually.'
              ),
          loadApiKey ? 'success' : 'warning'
        )
      } catch (error) {
        handleProviderBudgetError(error)
        showRehearsalAiToast(
          t('Unable to prepare rehearsal AI'),
          String((error && error.message) || error || '').trim() ||
            t('Unknown provider setup error'),
          'error'
        )
      } finally {
        setIsPreparingRehearsalAi(false)
      }
    },
    [
      rehearsalAiModel,
      rehearsalAiProvider,
      rehearsalAiProviderLabel,
      assertRemoteProviderBudgetAvailable,
      handleProviderBudgetError,
      settings.aiSolver,
      showRehearsalAiToast,
      startRehearsalNetworkForDialog,
      t,
      trimmedRehearsalApiKey,
      updateAiSolverSettings,
    ]
  )

  const prepareRealAutosolverWithoutAi = useCallback(async () => {
    setIsPreparingRehearsalAi(true)

    try {
      updateAiSolverSettings({
        enabled: false,
        mode: 'manual',
        onchainAutoSubmitConsentAt: '',
      })
      setIsRehearsalAiDialogOpen(false)
      showRehearsalAiToast(
        t('Real autosolver left off'),
        t(
          'No AI solver is armed for the real validation profile. You can come back and arm it before the next validation session.'
        ),
        'info'
      )
    } catch (error) {
      showRehearsalAiToast(
        t('Unable to update real autosolver'),
        String((error && error.message) || error || '').trim() ||
          t('Unknown real autosolver setup error'),
        'error'
      )
    } finally {
      setIsPreparingRehearsalAi(false)
    }
  }, [showRehearsalAiToast, t, updateAiSolverSettings])

  const prepareRealAutosolverWithLocalAi = useCallback(async () => {
    setIsPreparingRehearsalAi(true)

    try {
      const nextLocalAi = {
        ...(settings.localAi || {}),
        enabled: true,
      }
      const runtimePayload = buildLocalAiRuntimePayload(nextLocalAi)

      updateLocalAiSettings({enabled: true})
      updateAiSolverSettings({
        enabled: true,
        mode: 'session-auto',
        provider: 'local-ai',
        onchainAutoSubmitConsentAt:
          settings.aiSolver?.onchainAutoSubmitConsentAt ||
          new Date().toISOString(),
      })

      await getLocalAiBridge().start(runtimePayload)

      setIsRehearsalAiDialogOpen(false)
      showRehearsalAiToast(
        t('Real autosolver armed with Local AI'),
        t(
          'Local AI mode is enabled without a provider API key. The next real validation session may be solved and submitted automatically from this app profile.'
        ),
        'warning'
      )
    } catch (error) {
      showRehearsalAiToast(
        t('Unable to start Local AI'),
        String((error && error.message) || error || '').trim() ||
          t('Unknown local AI setup error'),
        'error'
      )
    } finally {
      setIsPreparingRehearsalAi(false)
    }
  }, [
    settings.aiSolver?.onchainAutoSubmitConsentAt,
    settings.localAi,
    showRehearsalAiToast,
    t,
    updateAiSolverSettings,
    updateLocalAiSettings,
  ])

  const prepareRealAutosolverWithAi = useCallback(
    async ({loadApiKey = false} = {}) => {
      const provider = resolveRehearsalAiProvider({
        provider: rehearsalAiProvider,
      })
      const model = resolveRehearsalAiModel(provider, rehearsalAiModel)

      setIsPreparingRehearsalAi(true)

      try {
        assertRemoteProviderBudgetAvailable({
          ...(settings.aiSolver || {}),
          provider,
          model,
        })

        if (loadApiKey) {
          await getAiSolverBridge().setProviderKey({
            provider,
            apiKey: trimmedRehearsalApiKey,
          })
          setRehearsalApiKey('')
          setIsRehearsalApiKeyVisible(false)
        }

        updateAiSolverSettings(
          loadApiKey
            ? {
                enabled: true,
                mode: 'session-auto',
                provider,
                model,
                onchainAutoSubmitConsentAt:
                  settings.aiSolver?.onchainAutoSubmitConsentAt ||
                  new Date().toISOString(),
              }
            : {
                enabled: true,
                mode: 'session-auto',
                onchainAutoSubmitConsentAt:
                  settings.aiSolver?.onchainAutoSubmitConsentAt ||
                  new Date().toISOString(),
              }
        )

        setIsRehearsalAiDialogOpen(false)
        showRehearsalAiToast(
          t('Real autosolver armed'),
          loadApiKey
            ? t(
                '{{provider}} {{model}} key loaded. Autosolver mode is enabled for the real validation profile and may submit answers on-chain automatically.',
                {
                  provider: rehearsalAiProviderLabel,
                  model,
                }
              )
            : t(
                'Autosolver mode is enabled with the already configured AI settings for the real validation profile and may submit answers on-chain automatically.'
              ),
          'warning'
        )
      } catch (error) {
        handleProviderBudgetError(error)
        showRehearsalAiToast(
          t('Unable to prepare real autosolver'),
          String((error && error.message) || error || '').trim() ||
            t('Unknown provider setup error'),
          'error'
        )
      } finally {
        setIsPreparingRehearsalAi(false)
      }
    },
    [
      rehearsalAiModel,
      rehearsalAiProvider,
      rehearsalAiProviderLabel,
      assertRemoteProviderBudgetAvailable,
      handleProviderBudgetError,
      settings.aiSolver?.onchainAutoSubmitConsentAt,
      settings.aiSolver,
      showRehearsalAiToast,
      t,
      trimmedRehearsalApiKey,
      updateAiSolverSettings,
    ]
  )

  const startAutosolveRehearsal = useCallback(() => {
    openRehearsalAiDialog()
  }, [openRehearsalAiDialog])

  const runRehearsalSolverLanes = async ({
    participantCount = REHEARSAL_DEFAULT_SOLVER_PARTICIPANT_COUNT,
  } = {}) => {
    const basePayload = buildRehearsalSolverLanePayload(
      settings.aiSolver || {},
      {
        participantCount,
      }
    )
    try {
      const budgetStatus = assertRemoteProviderBudgetAvailable({
        ...(settings.aiSolver || {}),
        provider: basePayload.provider,
        model: basePayload.model,
      })
      const payload =
        budgetStatus.remoteProvider && budgetStatus.enabled
          ? {
              ...basePayload,
              providerDailyBudgetEnabled: true,
              providerDailyBudgetRemainingUsd: budgetStatus.remainingUsd,
            }
          : {
              ...basePayload,
              providerDailyBudgetEnabled:
                (settings.aiSolver || {}).providerDailyBudgetEnabled !== false,
            }
      const result = await getNodeBridge().runValidationDevnetSolverLanes(
        payload
      )
      const summary =
        result?.parallelSolverLanes?.summary || result?.summary || null
      const actualUsd = Number(summary?.costs?.actualUsd)
      const estimatedUsd = Number(summary?.costs?.estimatedUsd)

      if (Number.isFinite(actualUsd) || Number.isFinite(estimatedUsd)) {
        appendAiProviderBudgetLedgerEntry({
          source: 'rehearsal-solver-lanes',
          action:
            participantCount > 1
              ? 'multi-identity rehearsal solver lanes'
              : 'single-identity rehearsal solver lane',
          provider: payload.provider,
          model: payload.model,
          tokenUsage: summary?.tokens,
          actualUsd: Number.isFinite(actualUsd) ? actualUsd : null,
          estimatedUsd: Number.isFinite(estimatedUsd) ? estimatedUsd : null,
        })
      }

      return result
    } catch (error) {
      handleProviderBudgetError(error)
      showRehearsalAiToast(
        t('Rehearsal solver blocked'),
        String((error && error.message) || error || '').trim() ||
          t('Unknown rehearsal solver error'),
        'error'
      )
      return null
    }
  }
  const runConfiguredAiSetup = isRealAutosolverDialog
    ? prepareRealAutosolverWithAi
    : startAutosolveRehearsalWithAi
  const runKeyedAiSetup = isRealAutosolverDialog
    ? () => prepareRealAutosolverWithAi({loadApiKey: true})
    : () => startAutosolveRehearsalWithAi({loadApiKey: true})
  const runLocalAiSetup = isRealAutosolverDialog
    ? prepareRealAutosolverWithLocalAi
    : startAutosolveRehearsalWithLocalAi
  const runNoAiSetup = isRealAutosolverDialog
    ? prepareRealAutosolverWithoutAi
    : startRehearsalWithoutAi
  const rehearsalDialogRemoteBudgetBlocked =
    isRehearsalRemoteAiMode && rehearsalDialogBudgetStatus.blocked

  let rehearsalDialogActions = (
    <>
      <SecondaryButton
        onClick={() => runConfiguredAiSetup()}
        isLoading={isPreparingRehearsalAi}
        isDisabled={
          isPreparingRehearsalAi || rehearsalDialogRemoteBudgetBlocked
        }
      >
        {isRealAutosolverDialog
          ? t('Arm with configured AI')
          : t('Start with configured AI')}
      </SecondaryButton>
      <PrimaryButton
        isDisabled={
          !trimmedRehearsalApiKey ||
          isPreparingRehearsalAi ||
          rehearsalDialogRemoteBudgetBlocked
        }
        isLoading={isPreparingRehearsalAi}
        onClick={runKeyedAiSetup}
      >
        {isRealAutosolverDialog ? t('Set key and arm') : t('Set key and start')}
      </PrimaryButton>
    </>
  )

  if (isRehearsalNoAiMode) {
    rehearsalDialogActions = (
      <PrimaryButton onClick={runNoAiSetup} isLoading={isPreparingRehearsalAi}>
        {isRealAutosolverDialog ? t('Keep AI off') : t('Start without AI')}
      </PrimaryButton>
    )
  } else if (isRehearsalLocalAiMode) {
    rehearsalDialogActions = (
      <PrimaryButton
        onClick={runLocalAiSetup}
        isLoading={isPreparingRehearsalAi}
      >
        {isRealAutosolverDialog
          ? t('Arm Local AI autosolver')
          : t('Start Local AI autosolver')}
      </PrimaryButton>
    )
  }

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

        <SettingsSection title={t('Real validation autosolver')} w="full">
          <Stack spacing={3}>
            <Text color="muted">
              {t(
                'Prepare the same AI autosolver setup for the real validation profile. This can auto-start solving and may submit answers on-chain automatically during a real ceremony.'
              )}
            </Text>
            <Box
              borderWidth="1px"
              borderColor={realAutosolverArmed ? 'orange.200' : 'gray.200'}
              bg={realAutosolverArmed ? 'orange.012' : 'gray.50'}
              borderRadius="md"
              p={3}
            >
              <Stack spacing={1}>
                <Text fontWeight={600}>
                  {realAutosolverArmed
                    ? t('Real autosolver is armed')
                    : t('Real autosolver is not armed')}
                </Text>
                <Text color="muted" fontSize="sm">
                  {realAutosolverArmed
                    ? t(
                        'Session-auto consent is stored in this app profile. Keep this enabled only when you are ready for automatic real-session solving and submission.'
                      )
                    : t(
                        'Use the setup dialog to choose Remote provider API, Local AI runtime, or no AI yet before the next real validation session.'
                      )}
                </Text>
                <Text color="orange.500" fontSize="sm">
                  {t(
                    'Provider cost warning: v0.0.6 can spend up to about $10 or more for one hard identity session when flips trigger long reasoning. Use prepaid API limits; testers are responsible for provider bills.'
                  )}
                </Text>
                <Text
                  color={
                    providerDailyBudgetStatus.blocked ? 'red.500' : 'muted'
                  }
                  fontSize="sm"
                >
                  {providerDailyBudgetNodeText}
                </Text>
              </Stack>
            </Box>
            <Flex align="center" gap={2} flexWrap="wrap">
              <PrimaryButton onClick={openRealAutosolverDialog}>
                {realAutosolverArmed
                  ? t('Review real autosolver setup')
                  : t('Prepare real autosolver')}
              </PrimaryButton>
              <SecondaryButton onClick={() => router.push('/settings/ai')}>
                {t('Open AI settings')}
              </SecondaryButton>
            </Flex>
          </Stack>
        </SettingsSection>

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
              <Text color="orange.500" mt={2}>
                {t(
                  'Take care: v0.0.6 remote-provider solving can cost about $1 to $10+ for one identity depending on flips, reasoning effort, retries, and provider pricing. A 10-identity rehearsal can multiply that. Use prepaid API limits; testers are responsible for provider bills.'
                )}
              </Text>
              <Text
                color={providerDailyBudgetStatus.blocked ? 'red.500' : 'muted'}
                mt={2}
                fontSize="sm"
              >
                {providerDailyBudgetStatus.blocked
                  ? t(
                      'Remote-provider rehearsal is blocked by the local daily API guardrail. {{usage}}.',
                      {usage: providerDailyBudgetUsageText}
                    )
                  : t(
                      'Local daily API guardrail: {{usage}}. Change, disable, or approve a higher cap in AI settings.',
                      {usage: providerDailyBudgetUsageText}
                    )}
              </Text>
            </Box>

            <Box
              borderWidth="1px"
              borderColor="blue.050"
              borderRadius="md"
              px={4}
              py={3}
            >
              <Stack spacing={2}>
                <Text fontWeight={500}>{t('Before clicking start here')}</Text>
                <Stack as="ol" spacing={1} pl={4} color="muted" fontSize="sm">
                  <Text as="li">
                    {t(
                      'Use Settings -> AI first: choose an external provider if needed, paste the provider API key, click Set key, then enable auto-solve for the next session.'
                    )}
                  </Text>
                  <Text as="li">
                    {t(
                      'For a clean local rehearsal, turn off Run built-in node in this panel before starting the rehearsal network.'
                    )}
                  </Text>
                  <Text as="li">
                    {t(
                      'After start, wait until the local nodes are ready, online, connected, and the seeded FLIP-Challenge flips are visible or confirmed.'
                    )}
                  </Text>
                  <Text as="li">
                    {t(
                      'When the countdown reaches zero, stay in the validation screen, watch the solve session, then review the audit/results screen.'
                    )}
                  </Text>
                </Stack>
              </Stack>
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
                    <Stack spacing={1}>
                      <Text color="muted">
                        {t('Ready nodes')}: {readyDevnetNodeCount} /{' '}
                        {devnetStatus.nodeCount}
                      </Text>
                      <Text color="muted">
                        {t('Connected local nodes')}: {connectedDevnetNodeCount}{' '}
                        / {devnetStatus.nodeCount}
                      </Text>
                    </Stack>
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
                  {typeof devnetStatus.seedPrimaryVisibleNodeCount ===
                    'number' &&
                    typeof devnetStatus.seedPrimaryExpectedNodeCount ===
                      'number' && (
                      <Text color="muted">
                        {t('Seed authors visible on primary node')}:{' '}
                        {devnetStatus.seedPrimaryVisibleNodeCount} /{' '}
                        {devnetStatus.seedPrimaryExpectedNodeCount}
                      </Text>
                    )}
                  {typeof devnetStatus.seedConfirmedNodeCount === 'number' &&
                    typeof devnetStatus.seedExpectedNodeCount === 'number' && (
                      <Text color="muted">
                        {t('Seed authors confirmed locally')}:{' '}
                        {devnetStatus.seedConfirmedNodeCount} /{' '}
                        {devnetStatus.seedExpectedNodeCount}
                      </Text>
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
                        rehearsalSolverLaneRunning ||
                        remoteRehearsalBudgetBlocked
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
                        rehearsalSolverLaneRunning ||
                        remoteRehearsalBudgetBlocked
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

              {remoteRehearsalBudgetBlocked && (
                <Stack spacing={2} align="flex-start">
                  <Text color="red.500" fontSize="sm">
                    {t(
                      'Remote-provider rehearsal buttons are disabled because the local daily API budget is reached. Approve a higher daily cap only if you intentionally accept more provider spend.'
                    )}
                  </Text>
                  <SecondaryButton
                    onClick={() =>
                      openProviderBudgetCapDialog(providerDailyBudgetStatus)
                    }
                  >
                    {t('Approve higher cap')}
                  </SecondaryButton>
                </Stack>
              )}

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
                            'Optional rehearsal-only dry run. It uses the current AI provider key in the main process, staggers participant request starts, records compact telemetry, and does not submit answers or touch mainnet identities. Take care: this can spend provider budget across nine extra rehearsal participants.'
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

      <Dialog
        isOpen={isRehearsalAiDialogOpen}
        onClose={closeRehearsalAiDialog}
        size="lg"
        title={
          isRealAutosolverDialog
            ? t('Prepare real autosolver')
            : t('Prepare rehearsal autosolver')
        }
        shouldShowCloseButton={!isPreparingRehearsalAi}
      >
        <DialogBody>
          <Stack spacing={4}>
            <Text color="muted" fontSize="sm">
              {isRealAutosolverDialog
                ? t(
                    'Choose how real validation autosolver should be armed. Remote providers need an API key, Local AI uses the configured local runtime without a provider key, and No AI leaves real autosolver off.'
                  )
                : t(
                    'Choose how this rehearsal should start. Remote providers need an API key, Local AI uses the configured local runtime without a provider key, and No AI starts only the rehearsal network.'
                  )}
            </Text>

            <Box
              borderWidth="1px"
              borderColor="orange.200"
              borderRadius="md"
              bg="orange.012"
              p={3}
            >
              <Stack spacing={1}>
                <Text fontWeight={600} fontSize="sm">
                  {t('Autosolver mode by default')}
                </Text>
                <Text color="muted" fontSize="sm">
                  {isRealAutosolverDialog
                    ? t(
                        'Saving a remote provider key or starting Local AI from this dialog sets AI mode to session-auto for real validation. It may submit answers on-chain automatically.'
                      )
                    : t(
                        'Saving a remote provider key or starting Local AI from this dialog sets AI mode to session-auto for the rehearsal. It will solve automatically once the rehearsal session starts.'
                      )}
                </Text>
                {!isRealAutosolverDialog && (
                  <Text color="orange.500" fontSize="sm">
                    {t(
                      'Provider-backed rehearsal can scale to one primary plus nine optional participant identities. In v0.0.6, one hard identity session may already cost about $10 or more; a full 10-identity run can multiply that.'
                    )}
                  </Text>
                )}
              </Stack>
            </Box>

            {isRehearsalRemoteAiMode && (
              <Box
                borderWidth="1px"
                borderColor={
                  rehearsalDialogBudgetStatus.blocked ? 'red.300' : 'orange.200'
                }
                borderRadius="md"
                bg={
                  rehearsalDialogBudgetStatus.blocked ? 'red.010' : 'orange.012'
                }
                p={3}
              >
                <Stack spacing={2}>
                  <Text fontWeight={600} fontSize="sm">
                    {t('Remote API daily guardrail')}
                  </Text>
                  <Text
                    color={
                      rehearsalDialogBudgetStatus.blocked ? 'red.500' : 'muted'
                    }
                    fontSize="sm"
                  >
                    {rehearsalDialogBudgetText}
                  </Text>
                  <SecondaryButton
                    alignSelf="flex-start"
                    onClick={openProviderBudgetCapApproval}
                    isDisabled={
                      rehearsalDialogBudgetStatus.enabled === false ||
                      isPreparingRehearsalAi
                    }
                  >
                    {t('Approve higher cap')}
                  </SecondaryButton>
                </Stack>
              </Box>
            )}

            <SettingsFormControl>
              <SettingsFormLabel>
                {isRealAutosolverDialog
                  ? t('Real autosolver mode')
                  : t('Rehearsal start mode')}
              </SettingsFormLabel>
              <Select
                value={rehearsalAiSetupMode}
                onChange={(event) =>
                  setRehearsalAiSetupMode(event.target.value)
                }
                isDisabled={isPreparingRehearsalAi}
              >
                <option value={REHEARSAL_AI_SETUP_MODES.Remote}>
                  {t('Remote provider API')}
                </option>
                <option value={REHEARSAL_AI_SETUP_MODES.Local}>
                  {t('Local AI runtime')}
                </option>
                <option value={REHEARSAL_AI_SETUP_MODES.None}>
                  {t('No AI yet')}
                </option>
              </Select>
            </SettingsFormControl>

            {isRehearsalRemoteAiMode && (
              <SettingsFormControl>
                <SettingsFormLabel>{t('External provider')}</SettingsFormLabel>
                <Select
                  value={rehearsalAiProvider}
                  onChange={(event) =>
                    updateRehearsalAiProvider(event.target.value)
                  }
                  isDisabled={isPreparingRehearsalAi}
                >
                  {REHEARSAL_AI_PROVIDER_OPTIONS.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </Select>
              </SettingsFormControl>
            )}

            {isRehearsalRemoteAiMode && (
              <SettingsFormControl>
                <SettingsFormLabel>{t('Model choice')}</SettingsFormLabel>
                <Stack spacing={2}>
                  <Select
                    value={rehearsalAiModelPresetValue}
                    onChange={(event) => {
                      const {value} = event.target
                      if (value === 'custom') {
                        return
                      }
                      setRehearsalAiModel(value)
                    }}
                    isDisabled={isPreparingRehearsalAi}
                  >
                    {rehearsalAiModelPresets.map((model) => (
                      <option key={model} value={model}>
                        {model}
                      </option>
                    ))}
                    <option value="custom">{t('Custom model id')}</option>
                  </Select>
                  <Input
                    value={rehearsalAiModel}
                    onChange={(event) =>
                      setRehearsalAiModel(event.target.value)
                    }
                    placeholder={
                      REHEARSAL_AI_DEFAULT_MODELS[rehearsalAiProvider] ||
                      'gpt-5.5'
                    }
                    isDisabled={isPreparingRehearsalAi}
                  />
                </Stack>
              </SettingsFormControl>
            )}

            {isRehearsalRemoteAiMode && (
              <SettingsFormControl>
                <SettingsFormLabel>{t('Provider API key')}</SettingsFormLabel>
                <InputGroup w="full">
                  <Input
                    value={rehearsalApiKey}
                    type={isRehearsalApiKeyVisible ? 'text' : 'password'}
                    placeholder={t('Paste provider API key')}
                    onChange={(event) => setRehearsalApiKey(event.target.value)}
                    isDisabled={isPreparingRehearsalAi}
                  />
                  <InputRightElement w="6" h="6" m="1">
                    <IconButton
                      size="xs"
                      aria-label={
                        isRehearsalApiKeyVisible
                          ? t('Hide provider API key')
                          : t('Show provider API key')
                      }
                      icon={
                        isRehearsalApiKeyVisible ? <EyeOffIcon /> : <EyeIcon />
                      }
                      bg={isRehearsalApiKeyVisible ? 'gray.300' : 'white'}
                      fontSize={20}
                      _hover={{
                        bg: isRehearsalApiKeyVisible ? 'gray.300' : 'white',
                      }}
                      onClick={() =>
                        setIsRehearsalApiKeyVisible(!isRehearsalApiKeyVisible)
                      }
                      isDisabled={isPreparingRehearsalAi}
                    />
                  </InputRightElement>
                </InputGroup>
                <Text color="muted" fontSize="sm" mt={2}>
                  {t(
                    'The key is loaded into memory for this desktop run. Use a prepaid key or hard provider budget without automatic top-up; experimental testers are responsible for API costs.'
                  )}
                </Text>
              </SettingsFormControl>
            )}

            {isRehearsalLocalAiMode && (
              <Box
                borderWidth="1px"
                borderColor="muted"
                borderRadius="md"
                p={3}
              >
                <Stack spacing={1}>
                  <Text fontWeight={600} fontSize="sm">
                    {t('Local AI does not need a provider API key')}
                  </Text>
                  <Text color="muted" fontSize="sm">
                    {t(
                      'IdenaAI will enable the configured Local AI runtime and use it for rehearsal autosolver mode. If the local runtime is not installed or reachable yet, start will show the Local AI error instead of silently falling back to a remote key.'
                    )}
                  </Text>
                </Stack>
              </Box>
            )}

            {isRehearsalNoAiMode && (
              <Box
                borderWidth="1px"
                borderColor="muted"
                borderRadius="md"
                p={3}
              >
                <Stack spacing={1}>
                  <Text fontWeight={600} fontSize="sm">
                    {isRealAutosolverDialog
                      ? t('Leave real autosolver off')
                      : t('Start the rehearsal network only')}
                  </Text>
                  <Text color="muted" fontSize="sm">
                    {isRealAutosolverDialog
                      ? t(
                          'This disables session-auto for the current app profile. You can arm real autosolver later before the validation session starts.'
                        )
                      : t(
                          'This disables session-auto for the current app profile and connects the rehearsal node without starting an AI solver. You can arm AI later before the short session starts.'
                        )}
                  </Text>
                </Stack>
              </Box>
            )}
          </Stack>
        </DialogBody>
        <DialogFooter>
          <SecondaryButton
            onClick={closeRehearsalAiDialog}
            isDisabled={isPreparingRehearsalAi}
          >
            {t('Cancel')}
          </SecondaryButton>
          {rehearsalDialogActions}
        </DialogFooter>
      </Dialog>
      <AiProviderBudgetCapDialog
        isOpen={isProviderBudgetCapDialogOpen}
        onClose={() => {
          setIsProviderBudgetCapDialogOpen(false)
          setProviderBudgetCapDialogStatus(null)
        }}
        status={providerBudgetCapDialogStatus || rehearsalDialogBudgetStatus}
        contextLabel={
          isRealAutosolverDialog
            ? t('Real validation remote AI is capped for this app profile.')
            : t('Rehearsal remote AI is capped for this app profile.')
        }
        onApprove={approveProviderDailyBudgetCap}
      />
    </SettingsLayout>
  )
}

export default NodeSettings
