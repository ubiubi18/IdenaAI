/* global BigInt */
/* eslint-disable react/prop-types */
import React from 'react'
import {
  Box,
  Button,
  Checkbox,
  Flex,
  FormControl,
  FormErrorMessage,
  FormLabel,
  Heading,
  Image,
  Input,
  Select,
  Stack,
  Text,
} from '@chakra-ui/react'
import Layout from './layout'
import {Page, PageTitle} from './components'
import {PrimaryButton, SecondaryButton} from './button'
import {useChainState} from '../providers/chain-context'
import {useIdentityState} from '../providers/identity-context'
import {useSettingsState} from '../providers/settings-context'
import {baseUnitsToIdna, idnaToBaseUnits} from '../utils/fod-v7-amount'

const OPERATIONS = [
  ['buy', 'Buy private flips'],
  ['buyPublicSeed', 'Buy public seed'],
  ['list', 'List private flips'],
  ['confirm', 'Confirm delivery'],
  ['challenge', 'Report a delivery problem'],
  ['startFallback', 'Start public fallback'],
  ['proveAndReveal', 'Prove and publish keys'],
  ['refund', 'Request refund'],
  ['relist', 'Relist flips'],
  ['cancel', 'Cancel listing'],
  ['expireHead', 'Expire oldest offer'],
  ['topUpBond', 'Top up seller bond'],
  ['slashUnproved', 'Slash unproved order'],
  ['qualify', 'Qualify bundle'],
  ['proveBundle', 'Prove bundle content'],
  ['seedBundle', 'Publish public seed'],
  ['activate', 'Activate with 10,000 iDNA'],
  ['privateMessage', 'Create private delivery file'],
  ['receive', 'Verify private delivery'],
]
const FLOWS = [
  {
    id: 'buy',
    label: 'Buy flips',
    description:
      'Private: buy → receive and verify keys → confirm. A public seed settles when bought.',
    operations: [
      'buy',
      'receive',
      'confirm',
      'challenge',
      'refund',
      'buyPublicSeed',
    ],
  },
  {
    id: 'sell',
    label: 'Sell flips',
    description:
      'Qualify and prove your bundle → list it → deliver keys privately.',
    operations: ['qualify', 'proveBundle', 'list', 'privateMessage'],
  },
  {
    id: 'resolve',
    label: 'Resolve an order',
    description:
      'Use the contract fallback for a funded order. Revealing keys makes them public.',
    operations: ['startFallback', 'proveAndReveal', 'slashUnproved'],
  },
  {
    id: 'more',
    label: 'Manage listings',
    description: 'Manage a listing, public seed, or market activation.',
    operations: [
      'seedBundle',
      'activate',
      'relist',
      'cancel',
      'expireHead',
      'topUpBond',
    ],
  },
]
const OPERATION_HINTS = {
  buy: 'Choose the original session bundle. The app checks it against the next offer before you sign.',
  buyPublicSeed:
    'These keys are already public. Buying settles immediately, with no private delivery or dispute. Half the price goes to the original author and half to the shared reserve.',
  receive:
    'Choose the seller’s private ciphertext. A verified receipt is saved locally.',
  confirm:
    'Choose the verified buyer receipt. Confirmation pays the original author the full first-sale price, or half the resale price; the other resale half enters the shared reserve. Your buyer bond returns.',
  challenge: 'Use this if the private delivery is missing or unusable.',
  refund:
    'The contract checks whether this funded order is ready for a refund.',
  privateMessage:
    'This saves ciphertext on your computer. You must send that file to the buyer privately.',
  activate: 'Activation permanently locks 10,000 iDNA in the contract.',
  proveAndReveal: 'This publishes the bundle keys for everyone to see.',
}
const OFFER_OPERATIONS = new Set([
  'activate',
  'buy',
  'buyPublicSeed',
  'relist',
  'cancel',
  'expireHead',
  'topUpBond',
])
const BUY_OPERATIONS = new Set(['buy', 'buyPublicSeed'])
const BUYER_ORDER_OPERATIONS = new Set([
  'receive',
  'confirm',
  'challenge',
  'refund',
])
const ORDER_OPERATIONS = new Set([
  'confirm',
  'challenge',
  'startFallback',
  'proveAndReveal',
  'refund',
  'slashUnproved',
  'privateMessage',
  'receive',
])
const VAULT_OPERATIONS = new Set([
  'seedBundle',
  'list',
  'proveAndReveal',
  'privateMessage',
  'receive',
])
const FILE_OPERATIONS = new Set([
  'qualify',
  'proveBundle',
  'seedBundle',
  'list',
  'buy',
  'confirm',
  'proveAndReveal',
  'privateMessage',
  'receive',
])
const MAX_FEE_BASE_UNITS = 100n * 10n ** 18n
const MAX_ORDER_ID = 18446744073709551615n
const OFFER_ID = /^(?:0x)?[0-9a-f]{64}$/i
const RECEIPT_ID = /^v7-receipt-[0-9a-f]{32}$/

function operationLabel(operation) {
  return OPERATIONS.find(([value]) => value === operation)?.[1] || operation
}

function positiveBaseUnits(value) {
  const units = idnaToBaseUnits(value)
  return units && BigInt(units) > 0n ? units : null
}

function amountLabel(amount) {
  const formatted = baseUnitsToIdna(amount)
  return formatted === null ? '—' : `${formatted} iDNA`
}

function buyerBondLabel(item) {
  if (item.operation !== 'buy') return null
  if (baseUnitsToIdna(item.amount) === null) return null
  if (baseUnitsToIdna(item.price) === null) return null
  const bond = BigInt(item.amount) - BigInt(item.price)
  return bond >= 0n ? amountLabel(bond.toString()) : null
}

function resultOrThrow(response) {
  if (response?.error) {
    const message = String(
      response.error.message || 'The market action was refused.'
    )
    throw new Error(
      message.replace(/\bV7\b/g, 'The market').replace(/\bv7\b/g, 'market')
    )
  }
  if (!response?.result)
    throw new Error('The market action returned no result.')
  return response.result
}

function Field({
  label,
  value,
  onChange,
  id,
  error,
  descriptionId,
  isRequired,
  ...props
}) {
  return (
    <FormControl isInvalid={Boolean(error)} isRequired={isRequired}>
      <FormLabel htmlFor={id}>{label}</FormLabel>
      <Input
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        autoComplete="off"
        aria-describedby={
          [descriptionId, error && `${id}-error`].filter(Boolean).join(' ') ||
          undefined
        }
        {...props}
      />
      {error && <FormErrorMessage id={`${id}-error`}>{error}</FormErrorMessage>}
    </FormControl>
  )
}

function BundlePreview({actionId, offerId}) {
  const [preview, setPreview] = React.useState(null)
  const [previewError, setPreviewError] = React.useState(false)
  const [retry, setRetry] = React.useState(0)

  React.useEffect(() => {
    let active = true
    setPreview(null)
    setPreviewError(false)
    const timer = setTimeout(
      () => {
        Promise.resolve()
          .then(() =>
            window.idena?.social?.v7?.(
              'preview',
              actionId ? {actionId} : {offerId}
            )
          )
          .then((response) => {
            const result = resultOrThrow(response)
            if (!Array.isArray(result.flips))
              throw new Error('The public flip preview could not be read.')
            if (active) setPreview(result)
          })
          .catch(() => {
            if (active) setPreviewError(true)
          })
      },
      actionId ? 0 : 300
    )
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [actionId, offerId, retry])

  const flips = Array.isArray(preview?.flips) ? preview.flips : []
  return (
    <Box mt={3}>
      <Text fontSize="sm" fontWeight={500} mb={1}>
        Public flip preview · Idena explorer
      </Text>
      {!preview && !previewError && (
        <Text color="muted" fontSize="sm">
          Loading images…
        </Text>
      )}
      {previewError && (
        <Text color="muted" fontSize="sm" role="status">
          The public flip preview could not load. Check your node connection or
          try again.
        </Text>
      )}
      {preview && flips.some((flip) => flip.images?.length) && (
        <>
          <Flex gap={2} flexWrap="wrap">
            {flips.map((flip, flipIndex) => (
              <Box key={flip.cid}>
                <Flex gap={1}>
                  {flip.images?.length ? (
                    flip.images.map((src, imageIndex) => (
                      <Image
                        key={imageIndex}
                        src={src}
                        alt={`Public image ${imageIndex + 1} of flip ${
                          flipIndex + 1
                        }`}
                        boxSize="96px"
                        objectFit="contain"
                        borderRadius="sm"
                        bg="gray.50"
                      />
                    ))
                  ) : (
                    <Box
                      w="196px"
                      h="96px"
                      bg="gray.50"
                      color="muted"
                      fontSize="xs"
                      display="flex"
                      alignItems="center"
                      justifyContent="center"
                    >
                      Image unavailable
                    </Box>
                  )}
                </Flex>
                <Text color="muted" fontSize="xs" mt={1}>
                  Flip {flipIndex + 1}
                </Text>
              </Box>
            ))}
          </Flex>
          <Text color="muted" fontSize="xs" mt={2}>
            Two public images per flip. Images help you browse; the purchase
            checks the original bundle before payment.
            {preview.count > flips.length &&
              ` Showing ${flips.length} of ${preview.count} flips.`}
          </Text>
        </>
      )}
      {preview && !flips.some((flip) => flip.images?.length) && (
        <Text color="muted" fontSize="sm">
          Explorer images are unavailable. The purchase checks the original
          bundle before payment.
        </Text>
      )}
      {(previewError ||
        (preview && !flips.some((flip) => flip.images?.length))) && (
        <SecondaryButton size="sm" mt={2} onClick={() => setRetry(retry + 1)}>
          Retry preview
        </SecondaryButton>
      )}
    </Box>
  )
}

export default function FlipMarketV7({onSelectV4}) {
  const {offline, syncing} = useChainState()
  const {address} = useIdentityState()
  const {internalPort, url, useExternalNode} = useSettingsState()
  const [state, setState] = React.useState(null)
  const [marketOffer, setMarketOffer] = React.useState(null)
  const [marketError, setMarketError] = React.useState('')
  const [loading, setLoading] = React.useState(true)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState('')
  const [notice, setNotice] = React.useState('')
  const [showConfig, setShowConfig] = React.useState(false)
  const [showAdvanced, setShowAdvanced] = React.useState(false)
  const [contract, setContract] = React.useState('')
  const [codeHash, setCodeHash] = React.useState('')
  const [binaryPath, setBinaryPath] = React.useState('')
  const [binarySha256, setBinarySha256] = React.useState('')
  const [flow, setFlow] = React.useState('buy')
  const [operation, setOperation] = React.useState('buy')
  const [offerId, setOfferId] = React.useState('')
  const [orderId, setOrderId] = React.useState('')
  const [maxFee, setMaxFee] = React.useState('')
  const [minimumPayout, setMinimumPayout] = React.useState('')
  const [amount, setAmount] = React.useState('')
  const [passphrase, setPassphrase] = React.useState('')
  const [sealedFallback, setSealedFallback] = React.useState(false)
  const [purchaseActionId, setPurchaseActionId] = React.useState('')
  const [orderLookupState, setOrderLookupState] = React.useState('')
  const [orderLookupError, setOrderLookupError] = React.useState('')
  const [orderLookupLoading, setOrderLookupLoading] = React.useState(false)
  const [sellerLookupState, setSellerLookupState] = React.useState('')
  const [sellerLookupError, setSellerLookupError] = React.useState('')
  const [sellerLookupLoading, setSellerLookupLoading] = React.useState(false)
  const [verifiedReceipt, setVerifiedReceipt] = React.useState(null)
  const requestRef = React.useRef(0)
  const orderLookupRef = React.useRef(0)
  const sellerLookupRef = React.useRef(0)

  const load = React.useCallback(async () => {
    requestRef.current += 1
    const request = requestRef.current
    setLoading(true)
    try {
      const next = resultOrThrow(await window.idena?.social?.v7?.('status'))
      if (request !== requestRef.current) return
      if (
        typeof next.configured !== 'boolean' ||
        !Array.isArray(next.actions)
      ) {
        throw new Error('Saved market state could not be read.')
      }
      let offer = null
      let offerError = ''
      if (next.configured) {
        try {
          offer = resultOrThrow(await window.idena?.social?.v7?.('nextOffer'))
          if (typeof offer.available !== 'boolean')
            throw new Error('The next bundle could not be read.')
        } catch (cause) {
          offerError = cause.message
        }
      }
      if (request !== requestRef.current) return
      setState(next)
      setMarketOffer(offer)
      setMarketError(offerError)
      setError('')
      setShowConfig(!next.configured)
    } catch (cause) {
      if (request === requestRef.current) {
        setMarketOffer(null)
        setMarketError(cause.message)
        setError(cause.message)
      }
    } finally {
      if (request === requestRef.current) setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    orderLookupRef.current += 1
    sellerLookupRef.current += 1
    setState(null)
    setNotice('')
    setError('')
    setPurchaseActionId('')
    setOrderId('')
    setOrderLookupState('')
    setOrderLookupError('')
    setOrderLookupLoading(false)
    setSellerLookupState('')
    setSellerLookupError('')
    setSellerLookupLoading(false)
    setVerifiedReceipt(null)
    load()
    return () => {
      requestRef.current += 1
      orderLookupRef.current += 1
      sellerLookupRef.current += 1
    }
  }, [address, internalPort, url, useExternalNode, load])

  React.useEffect(() => {
    if (marketOffer?.available && BUY_OPERATIONS.has(operation)) {
      const nextOperation = marketOffer.publicSeed ? 'buyPublicSeed' : 'buy'
      if (operation !== nextOperation) setOperation(nextOperation)
    }
  }, [marketOffer, operation])

  const canAct =
    Boolean(address) &&
    !offline &&
    !syncing &&
    !busy &&
    !loading &&
    !orderLookupLoading &&
    !sellerLookupLoading
  const savedBuys =
    state?.actions.filter((item) => item.operation === 'buy') || []
  const sentBuys = savedBuys.filter(
    (item) => item.attempted && !item.pinChanged
  )

  const run = async (method, data, successText) => {
    if (!canAct) return
    setBusy(true)
    setError('')
    setNotice('')
    const currentRequest = requestRef.current
    try {
      const result = resultOrThrow(
        await window.idena?.social?.v7?.(method, data)
      )
      if (currentRequest !== requestRef.current) return
      if (method === 'configure') {
        orderLookupRef.current += 1
        sellerLookupRef.current += 1
        setPurchaseActionId('')
        setOrderId('')
        setOrderLookupState('')
        setOrderLookupError('')
        setOrderLookupLoading(false)
        setSellerLookupState('')
        setSellerLookupError('')
        setSellerLookupLoading(false)
        setVerifiedReceipt(null)
        setState(result)
        setShowConfig(false)
        setBinaryPath('')
        setBinarySha256('')
        await load()
      } else if (method === 'prepare') {
        const maxSpend =
          result.maxFee &&
          (BigInt(result.amount) + BigInt(result.maxFee)).toString()
        setNotice(
          `${successText}. Attached: ${amountLabel(result.amount)}. ${
            maxSpend
              ? `Maximum funds needed including network fee: ${amountLabel(
                  maxSpend
                )}. `
              : ''
          }Review the saved action below.`
        )
        await load()
      } else if (method === 'submit' || method === 'check') {
        const action = state?.actions.find(
          (item) => item.actionId === data.actionId
        )
        const txStateLabel =
          {
            included: 'Included',
            failed: 'Failed on-chain',
          }[result.status] || 'Outcome uncertain'
        let nextNotice = `${txStateLabel} · ${result.txHash || ''}`
        if (result.status === 'cancelled') {
          nextNotice = 'No transaction was signed.'
        } else if (
          result.status === 'included' &&
          action?.operation === 'buy'
        ) {
          nextNotice = `Private purchase included. The seller must send the ciphertext privately. Verify it before confirming delivery. Transaction: ${
            result.txHash || 'recorded'
          }`
        } else if (
          result.status === 'included' &&
          action?.operation === 'buyPublicSeed'
        ) {
          nextNotice = `Public seed purchase included and settled. Its keys were already public. Transaction: ${
            result.txHash || 'recorded'
          }`
        }
        setNotice(nextNotice)
        await load()
      } else if (method === 'receive') {
        const savedReceipt = RECEIPT_ID.test(result.receiptId)
          ? {
              id: result.receiptId,
              orderId: data.orderId,
              purchaseActionId: data.actionId,
            }
          : null
        setVerifiedReceipt(savedReceipt)
        let receiptLocation = 'The receipt is saved in this app’s local data.'
        if (savedReceipt) {
          receiptLocation = 'The saved receipt is ready for confirmation.'
        } else if (result.folderOpened) {
          receiptLocation = 'The receipt folder is open.'
        }
        setNotice(
          `Verified ${result.usableFlips} original flips. ${receiptLocation} Next, confirm this order.`
        )
        setFlow('buy')
        setOperation('confirm')
      } else {
        setNotice(
          method === 'privateMessage'
            ? `Ciphertext saved locally. ${
                result.folderOpened
                  ? 'The folder is open.'
                  : 'Find it in this app’s local data.'
              } Send the file to the buyer privately yourself.`
            : successText
        )
      }
    } catch (cause) {
      if (currentRequest === requestRef.current) setError(cause.message)
    } finally {
      setPassphrase('')
      setBusy(false)
    }
  }

  const choosePurchase = async (actionId) => {
    orderLookupRef.current += 1
    const request = orderLookupRef.current
    setPurchaseActionId(actionId)
    setOrderId('')
    setOrderLookupState('')
    setOrderLookupError('')
    setVerifiedReceipt(null)
    if (!actionId) {
      setOrderLookupLoading(false)
      return
    }
    setOrderLookupLoading(true)
    try {
      const found = resultOrThrow(
        await window.idena?.social?.v7?.('purchaseOrder', {actionId})
      )
      if (request !== orderLookupRef.current) return
      if (
        !/^[1-9][0-9]*$/.test(found.orderId) ||
        !['funded', 'fallback'].includes(found.state)
      ) {
        throw new Error('The saved purchase has no valid active order.')
      }
      setOrderId(found.orderId)
      setOrderLookupState(found.state)
    } catch (cause) {
      if (request === orderLookupRef.current) setOrderLookupError(cause.message)
    } finally {
      if (request === orderLookupRef.current) setOrderLookupLoading(false)
    }
  }

  const chooseSellerOffer = (value) => {
    sellerLookupRef.current += 1
    setOfferId(value.trim())
    setOrderId('')
    setSellerLookupState('')
    setSellerLookupError('')
    setSellerLookupLoading(false)
  }

  const findSellerOrder = async (selectedOfferId) => {
    if (!canAct || !OFFER_ID.test(selectedOfferId)) return
    sellerLookupRef.current += 1
    const request = sellerLookupRef.current
    setFlow('sell')
    setOperation('privateMessage')
    setOfferId(selectedOfferId)
    setPurchaseActionId('')
    setVerifiedReceipt(null)
    setOrderId('')
    setSellerLookupState('')
    setSellerLookupError('')
    setSellerLookupLoading(true)
    try {
      const found = resultOrThrow(
        await window.idena?.social?.v7?.('sellerOrder', {
          offerId: selectedOfferId,
        })
      )
      if (request !== sellerLookupRef.current) return
      if (!/^[1-9][0-9]*$/.test(found.orderId) || found.state !== 'funded') {
        throw new Error('This listing has no valid funded private order.')
      }
      setOrderId(found.orderId)
      setSellerLookupState('funded')
    } catch (cause) {
      if (request === sellerLookupRef.current)
        setSellerLookupError(cause.message)
    } finally {
      if (request === sellerLookupRef.current) setSellerLookupLoading(false)
    }
  }

  const configure = (event) => {
    event.preventDefault()
    run(
      'configure',
      {contract, codeHash, binaryPath, binarySha256},
      'Local deployment pin saved.'
    )
  }

  const chooseBinary = async () => {
    if (!canAct) return
    setBusy(true)
    setError('')
    try {
      const selected = resultOrThrow(
        await window.idena?.social?.v7?.('chooseBinary')
      )
      if (selected.path) {
        setBinaryPath(selected.path)
        setBinarySha256('')
      }
    } catch (cause) {
      setError(cause.message)
    } finally {
      setBusy(false)
    }
  }

  const useVerifiedReceipt =
    operation === 'confirm' &&
    verifiedReceipt?.orderId === orderId &&
    verifiedReceipt?.purchaseActionId === purchaseActionId

  const prepare = (event) => {
    event.preventDefault()
    if (operation === 'privateMessage') {
      run(
        'privateMessage',
        {orderId, passphrase},
        'Ciphertext saved locally. Its folder is open; send the file privately yourself.'
      )
      return
    }
    if (operation === 'receive') {
      run(
        'receive',
        {actionId: purchaseActionId, orderId, passphrase},
        'Private delivery verified.'
      )
      return
    }
    run(
      'prepare',
      {
        operation,
        offerId: BUY_OPERATIONS.has(operation)
          ? marketOffer?.offerId || ''
          : offerId.toLowerCase(),
        orderId,
        maxFee: positiveBaseUnits(maxFee),
        minimumPayout: minimumPayout ? positiveBaseUnits(minimumPayout) : '',
        amount: positiveBaseUnits(amount),
        ...(operation === 'startFallback' ? {sealedFallback} : {}),
        ...(useVerifiedReceipt ? {receiptId: verifiedReceipt.id} : {}),
        passphrase,
      },
      'Prepared market action'
    )
  }

  let prepareLabel = 'Choose files and prepare'
  if (operation === 'receive') prepareLabel = 'Verify delivery'
  else if (operation === 'privateMessage') prepareLabel = 'Save ciphertext'
  else if (operation === 'buy')
    prepareLabel = 'Choose session and prepare purchase'
  else if (operation === 'confirm')
    prepareLabel = useVerifiedReceipt
      ? 'Prepare confirmation'
      : 'Choose receipt and prepare confirmation'
  else if (!FILE_OPERATIONS.has(operation))
    prepareLabel = `Prepare ${operationLabel(operation).toLowerCase()}`

  const selectedFlow = FLOWS.find((item) => item.id === flow)
  const buyOperation = marketOffer?.publicSeed ? 'buyPublicSeed' : 'buy'
  const flowOperations =
    flow === 'buy' && marketOffer?.available
      ? selectedFlow.operations.filter(
          (item) => !BUY_OPERATIONS.has(item) || item === buyOperation
        )
      : selectedFlow.operations
  const feeUnits = positiveBaseUnits(maxFee)
  const validFee = feeUnits && BigInt(feeUnits) <= MAX_FEE_BASE_UNITS
  const validMinimumPayout =
    !['list', 'relist'].includes(operation) ||
    !minimumPayout ||
    Boolean(positiveBaseUnits(minimumPayout))
  const validTopUp =
    operation !== 'topUpBond' || Boolean(positiveBaseUnits(amount))
  const validOfferId =
    !OFFER_OPERATIONS.has(operation) ||
    (BUY_OPERATIONS.has(operation)
      ? marketOffer?.available &&
        !marketError &&
        operation === buyOperation &&
        marketOffer.bondTopUp === '0' &&
        OFFER_ID.test(marketOffer.offerId)
      : OFFER_ID.test(offerId))
  const validOrderId =
    !ORDER_OPERATIONS.has(operation) ||
    (/^[1-9][0-9]*$/.test(orderId) && BigInt(orderId) <= MAX_ORDER_ID)
  const validSavedOrder =
    !BUYER_ORDER_OPERATIONS.has(operation) ||
    !purchaseActionId ||
    (!orderLookupLoading &&
      !orderLookupError &&
      (orderLookupState === 'funded' ||
        (operation === 'refund' && orderLookupState === 'fallback')))
  let preparationProblem = ''
  if (!validOfferId) {
    preparationProblem = BUY_OPERATIONS.has(operation)
      ? 'Wait for an available bundle with a valid quote.'
      : 'Enter the seller’s offer code.'
  } else if (!validOrderId) {
    preparationProblem = 'Enter a valid order number.'
  } else if (!validSavedOrder) {
    preparationProblem = 'Check the saved purchase and its current order state.'
  } else if (operation === 'receive' && !purchaseActionId) {
    preparationProblem = 'Choose a saved private purchase.'
  } else if (VAULT_OPERATIONS.has(operation) && !passphrase) {
    preparationProblem = 'Enter the vault passphrase.'
  } else if (!['privateMessage', 'receive'].includes(operation) && !validFee) {
    preparationProblem =
      'Enter a maximum network fee above 0 and at most 100 iDNA.'
  } else if (!validMinimumPayout) {
    preparationProblem = 'Enter a valid minimum seller payout.'
  } else if (!validTopUp) {
    preparationProblem = 'Enter a valid bond top-up.'
  }
  const chooseOperation = (nextOperation) => {
    orderLookupRef.current += 1
    sellerLookupRef.current += 1
    setOperation(nextOperation)
    setOrderId('')
    setPurchaseActionId('')
    setOrderLookupState('')
    setOrderLookupError('')
    setOrderLookupLoading(false)
    setSellerLookupState('')
    setSellerLookupError('')
    setSellerLookupLoading(false)
    setVerifiedReceipt(null)
  }

  const chooseFlow = (nextFlow) => {
    setFlow(nextFlow.id)
    chooseOperation(nextFlow.operations[0])
  }

  const toggleAdvanced = () => {
    if (showAdvanced && !['buy', 'sell'].includes(flow)) chooseFlow(FLOWS[0])
    setShowAdvanced(!showAdvanced)
  }

  return (
    <Layout syncing={syncing} offline={offline}>
      <Page>
        <Box w="full" maxW="5xl">
          <Flex align="center" justify="space-between" gap={3} mb={5}>
            <Box>
              <PageTitle mb={0}>Flips on Demand</PageTitle>
              <Text color="muted" fontSize="sm">
                Experimental v0.1 · Decentralized settlement · No app fee
              </Text>
            </Box>
            <Flex gap={2}>
              <SecondaryButton
                onClick={load}
                isLoading={loading}
                isDisabled={busy || orderLookupLoading || sellerLookupLoading}
              >
                Refresh
              </SecondaryButton>
            </Flex>
          </Flex>

          {offline && (
            <Text color="muted" mb={4}>
              Connect a local node before using the market.
            </Text>
          )}
          {!offline && syncing && (
            <Text color="muted" mb={4}>
              Wait for your node to finish syncing.
            </Text>
          )}
          {!address && (
            <Text color="muted" mb={4}>
              Select an identity to use the market.
            </Text>
          )}
          {error && (
            <Text color="red.500" role="alert" mb={4}>
              {error}
            </Text>
          )}
          {notice && (
            <Text color="green.600" role="status" mb={4}>
              {notice}
            </Text>
          )}

          {state?.configured && !showConfig && (
            <Flex align="center" justify="space-between" gap={3} mb={8}>
              <Text fontSize="sm" color="muted" fontFamily="mono">
                Local pin · {state.contract.slice(0, 10)}…
                {state.contract.slice(-6)}
              </Text>
              <Button
                size="sm"
                variant="link"
                onClick={() => setShowConfig(true)}
              >
                Change pin
              </Button>
            </Flex>
          )}

          {showConfig && (
            <Box as="section" aria-label="Local market connection" mb={9}>
              <Heading as="h2" fontSize="lg" fontWeight={500} mb={2}>
                Check a settlement contract
              </Heading>
              <Text color="muted" fontSize="sm" mb={4}>
                Use your synced local node and separately built Flips on Demand
                tool. This checks the values you enter against your node and
                local tool; it does not establish who deployed the contract or
                whether its code is safe. Check their provenance independently.
              </Text>
              <Box as="form" onSubmit={configure} maxW="lg">
                <Stack spacing={3}>
                  <Field
                    id="v7-contract"
                    label="Contract address"
                    value={contract}
                    onChange={setContract}
                    isRequired
                    isDisabled={!canAct}
                  />
                  <Field
                    id="v7-code-hash"
                    label="Expected deployed code hash"
                    value={codeHash}
                    onChange={setCodeHash}
                    isRequired
                    isDisabled={!canAct}
                  />
                  <Field
                    id="v7-binary"
                    label="Local Flips on Demand tool path"
                    value={binaryPath}
                    onChange={setBinaryPath}
                    isRequired
                    isDisabled={!canAct}
                  />
                  <SecondaryButton
                    size="sm"
                    alignSelf="flex-start"
                    onClick={chooseBinary}
                    isDisabled={!canAct}
                  >
                    Choose tool file
                  </SecondaryButton>
                  <Field
                    id="v7-binary-hash"
                    label="CLI SHA-256"
                    value={binarySha256}
                    onChange={setBinarySha256}
                    isRequired
                    isDisabled={!canAct}
                  />
                  <PrimaryButton
                    type="submit"
                    isLoading={busy}
                    aria-describedby={
                      !contract || !codeHash || !binaryPath || !binarySha256
                        ? 'v7-connection-help'
                        : undefined
                    }
                    isDisabled={
                      !canAct ||
                      !contract ||
                      !codeHash ||
                      !binaryPath ||
                      !binarySha256
                    }
                  >
                    Check and save pins
                  </PrimaryButton>
                  {(!contract || !codeHash || !binaryPath || !binarySha256) && (
                    <Text id="v7-connection-help" color="muted" fontSize="sm">
                      Enter all four values from independently verified sources.
                    </Text>
                  )}
                </Stack>
              </Box>
            </Box>
          )}

          {state?.configured && (
            <>
              <Box as="section" aria-label="Market action" mb={10}>
                <Flex
                  gap={2}
                  flexWrap="wrap"
                  mb={5}
                  role="group"
                  aria-label="Market task"
                >
                  {FLOWS.slice(0, 2).map((item) => (
                    <Button
                      key={item.id}
                      size="sm"
                      variant={flow === item.id ? 'primary' : 'secondary'}
                      aria-pressed={flow === item.id}
                      onClick={() => chooseFlow(item)}
                    >
                      {item.label}
                    </Button>
                  ))}
                  <Button
                    size="sm"
                    variant="secondary"
                    aria-expanded={showAdvanced}
                    onClick={toggleAdvanced}
                  >
                    Advanced
                  </Button>
                </Flex>
                {showAdvanced && (
                  <Flex gap={2} flexWrap="wrap" mb={5}>
                    {FLOWS.slice(2).map((item) => (
                      <Button
                        key={item.id}
                        size="sm"
                        variant={flow === item.id ? 'primary' : 'secondary'}
                        aria-pressed={flow === item.id}
                        onClick={() => chooseFlow(item)}
                      >
                        {item.label}
                      </Button>
                    ))}
                    <SecondaryButton size="sm" onClick={onSelectV4}>
                      Previous test market
                    </SecondaryButton>
                  </Flex>
                )}
                <Heading as="h2" fontSize="lg" fontWeight={500} mb={1}>
                  {selectedFlow.label}
                </Heading>
                <Text color="muted" fontSize="sm" mb={5}>
                  {selectedFlow.description}
                </Text>
                <Box as="form" onSubmit={prepare} maxW="lg">
                  <Stack spacing={4}>
                    <FormControl>
                      <FormLabel htmlFor="v7-operation">Next step</FormLabel>
                      <Select
                        id="v7-operation"
                        value={operation}
                        onChange={(event) =>
                          chooseOperation(event.target.value)
                        }
                        isDisabled={!canAct}
                      >
                        {flowOperations.map((value) => (
                          <option key={value} value={value}>
                            {operationLabel(value)}
                          </option>
                        ))}
                      </Select>
                    </FormControl>
                    {OPERATION_HINTS[operation] && (
                      <Text color="muted" fontSize="sm">
                        {OPERATION_HINTS[operation]}
                      </Text>
                    )}
                    {OFFER_OPERATIONS.has(operation) &&
                      !BUY_OPERATIONS.has(operation) && (
                        <Field
                          id="v7-offer"
                          label="Seller’s offer code"
                          value={offerId}
                          onChange={(value) => setOfferId(value.trim())}
                          isRequired
                          error={
                            offerId && !validOfferId
                              ? 'The offer code needs 64 hexadecimal characters.'
                              : ''
                          }
                          placeholder="Paste the 64-character code"
                          isDisabled={!canAct}
                        />
                      )}
                    {BUY_OPERATIONS.has(operation) && (
                      <Box>
                        <Text fontWeight={500} fontSize="sm">
                          Next available bundle
                        </Text>
                        {marketError && (
                          <Text color="red.500" role="alert" fontSize="sm">
                            {marketError}
                          </Text>
                        )}
                        {!marketError && !marketOffer?.available && (
                          <Text color="muted" fontSize="sm">
                            No bundle is available from your node right now.
                          </Text>
                        )}
                        {marketOffer?.available && !marketError && (
                          <>
                            <Text fontSize="sm">
                              {marketOffer.count} original flips · Epoch{' '}
                              {marketOffer.epoch} ·{' '}
                              {marketOffer.publicSeed
                                ? 'Public keys'
                                : 'Private delivery'}
                            </Text>
                            <Text fontSize="sm">
                              Price {amountLabel(marketOffer.price)}
                              {!marketOffer.publicSeed &&
                                ` · Buyer bond ${amountLabel(
                                  marketOffer.buyerBond
                                )}`}
                              {' · '}Total attached{' '}
                              {amountLabel(marketOffer.total)}
                            </Text>
                            <Text color="muted" fontSize="xs">
                              Observed at block {marketOffer.blockHeight}.
                              Network fee is additional; values are checked
                              again before signing.
                            </Text>
                            {validFee && (
                              <Text fontSize="sm">
                                Maximum funds needed with your fee cap:{' '}
                                {amountLabel(
                                  (
                                    BigInt(marketOffer.total) + BigInt(feeUnits)
                                  ).toString()
                                )}
                              </Text>
                            )}
                            {marketOffer.bondTopUp !== '0' && (
                              <Text color="red.500" role="alert" fontSize="sm">
                                Buying is paused until the seller tops up their
                                bond.
                              </Text>
                            )}
                            <BundlePreview offerId={marketOffer.offerId} />
                          </>
                        )}
                      </Box>
                    )}
                    {BUYER_ORDER_OPERATIONS.has(operation) && (
                      <FormControl>
                        <FormLabel htmlFor="v7-purchase">
                          Saved private purchase
                          {operation !== 'receive' && ' (optional)'}
                        </FormLabel>
                        <Select
                          id="v7-purchase"
                          value={purchaseActionId}
                          onChange={(event) =>
                            choosePurchase(event.target.value)
                          }
                          isDisabled={!canAct}
                        >
                          <option value="">Choose purchase</option>
                          {sentBuys.map((item) => (
                            <option key={item.actionId} value={item.actionId}>
                              {item.actionId.slice(-8)} ·{' '}
                              {item.offerId.slice(0, 10)}…
                            </option>
                          ))}
                        </Select>
                      </FormControl>
                    )}
                    {orderLookupLoading && (
                      <Text color="muted" fontSize="sm">
                        Checking the saved purchase on your node…
                      </Text>
                    )}
                    {orderLookupError &&
                      BUYER_ORDER_OPERATIONS.has(operation) && (
                        <Text color="red.500" fontSize="sm" role="alert">
                          {orderLookupError}
                        </Text>
                      )}
                    {purchaseActionId &&
                      orderLookupState === 'fallback' &&
                      ['receive', 'confirm', 'challenge'].includes(
                        operation
                      ) && (
                        <Text color="red.500" fontSize="sm" role="alert">
                          This order is in public fallback. Private confirmation
                          and new challenges are closed.
                        </Text>
                      )}
                    {operation === 'privateMessage' && (
                      <Box>
                        <Field
                          id="v7-seller-offer"
                          label="Your listed offer code (optional)"
                          value={offerId}
                          onChange={chooseSellerOffer}
                          error={
                            offerId && !OFFER_ID.test(offerId)
                              ? 'The offer code needs 64 hexadecimal characters.'
                              : ''
                          }
                          placeholder="Paste the 64-character code"
                          isDisabled={!canAct}
                        />
                        <SecondaryButton
                          size="sm"
                          mt={2}
                          isDisabled={!canAct || !OFFER_ID.test(offerId)}
                          onClick={() => findSellerOrder(offerId)}
                        >
                          Find funded order
                        </SecondaryButton>
                      </Box>
                    )}
                    {operation === 'privateMessage' && sellerLookupLoading && (
                      <Text color="muted" fontSize="sm">
                        Checking the funded order on your node…
                      </Text>
                    )}
                    {operation === 'privateMessage' && sellerLookupError && (
                      <Text color="red.500" fontSize="sm" role="alert">
                        {sellerLookupError}
                      </Text>
                    )}
                    {ORDER_OPERATIONS.has(operation) && (
                      <Field
                        id="v7-order"
                        label="Order number"
                        value={orderId}
                        onChange={(value) => {
                          setOrderId(value)
                          if (operation === 'privateMessage')
                            setSellerLookupState('')
                        }}
                        isRequired
                        error={
                          orderId && !validOrderId
                            ? 'Enter a valid order number.'
                            : ''
                        }
                        isDisabled={
                          !canAct ||
                          (BUYER_ORDER_OPERATIONS.has(operation) &&
                            Boolean(purchaseActionId)) ||
                          (operation === 'privateMessage' &&
                            sellerLookupState === 'funded')
                        }
                      />
                    )}
                    {!['privateMessage', 'receive'].includes(operation) && (
                      <Field
                        id="v7-fee"
                        label="Maximum network fee (iDNA)"
                        value={maxFee}
                        onChange={setMaxFee}
                        inputMode="decimal"
                        isRequired
                        descriptionId="v7-fee-help"
                        error={
                          maxFee && !validFee
                            ? 'Enter a fee cap above 0 and at most 100 iDNA.'
                            : ''
                        }
                        isDisabled={!canAct}
                      />
                    )}
                    {!['privateMessage', 'receive'].includes(operation) && (
                      <Text id="v7-fee-help" color="muted" fontSize="sm">
                        Set the most you permit for the network fee. The exact
                        call is simulated during preparation and checked again
                        before signing.
                      </Text>
                    )}
                    {['list', 'relist'].includes(operation) && (
                      <Field
                        id="v7-min-payout"
                        label="Minimum seller payout (iDNA, optional)"
                        value={minimumPayout}
                        onChange={setMinimumPayout}
                        inputMode="decimal"
                        error={
                          !validMinimumPayout
                            ? 'Enter a positive iDNA amount with at most 18 decimal places.'
                            : ''
                        }
                        isDisabled={!canAct}
                      />
                    )}
                    {operation === 'topUpBond' && (
                      <Field
                        id="v7-amount"
                        label="Bond top-up (iDNA)"
                        value={amount}
                        onChange={setAmount}
                        inputMode="decimal"
                        isRequired
                        error={
                          amount && !validTopUp
                            ? 'Enter a positive iDNA amount with at most 18 decimal places.'
                            : ''
                        }
                        isDisabled={!canAct}
                      />
                    )}
                    {operation === 'startFallback' && (
                      <Checkbox
                        isChecked={sealedFallback}
                        onChange={(event) =>
                          setSealedFallback(event.target.checked)
                        }
                        isDisabled={!canAct}
                      >
                        Include a content proof for an unproved bundle
                      </Checkbox>
                    )}
                    {VAULT_OPERATIONS.has(operation) && (
                      <Field
                        id="v7-passphrase"
                        label={
                          operation === 'receive'
                            ? 'New buyer vault passphrase'
                            : 'Vault passphrase'
                        }
                        value={passphrase}
                        onChange={setPassphrase}
                        type="password"
                        isRequired
                        isDisabled={!canAct}
                      />
                    )}
                    {useVerifiedReceipt && (
                      <Flex align="center" gap={2}>
                        <Text fontSize="sm" color="muted">
                          Using the receipt you just verified on this computer.
                        </Text>
                        <Button
                          size="sm"
                          variant="link"
                          onClick={() => setVerifiedReceipt(null)}
                        >
                          Choose another
                        </Button>
                      </Flex>
                    )}
                    {(FILE_OPERATIONS.has(operation) && !useVerifiedReceipt) ||
                    (operation === 'startFallback' && sealedFallback) ? (
                      <Text fontSize="sm" color="muted">
                        The app will ask for the required local files.
                      </Text>
                    ) : null}
                    {canAct && preparationProblem && (
                      <Text
                        id="v7-preparation-help"
                        color="muted"
                        fontSize="sm"
                        role="status"
                      >
                        {preparationProblem}
                      </Text>
                    )}
                    <PrimaryButton
                      type="submit"
                      isLoading={busy}
                      aria-describedby={
                        canAct && preparationProblem
                          ? 'v7-preparation-help'
                          : undefined
                      }
                      isDisabled={
                        !canAct ||
                        !validOfferId ||
                        !validOrderId ||
                        !validSavedOrder ||
                        (operation === 'receive' && !purchaseActionId) ||
                        (VAULT_OPERATIONS.has(operation) && !passphrase) ||
                        (!['privateMessage', 'receive'].includes(operation) &&
                          !validFee) ||
                        !validMinimumPayout ||
                        !validTopUp
                      }
                    >
                      {prepareLabel}
                    </PrimaryButton>
                  </Stack>
                </Box>
              </Box>

              <Box as="section" aria-label="Saved market actions">
                <Heading as="h2" fontSize="lg" fontWeight={500} mb={3}>
                  Saved actions
                </Heading>
                {state.actions.length === 0 && (
                  <Text color="muted" fontSize="sm">
                    No prepared actions for this identity.
                  </Text>
                )}
                <Stack
                  spacing={0}
                  borderTopWidth={state.actions.length ? '1px' : 0}
                  borderColor="gray.100"
                >
                  {state.actions.map((item) => (
                    <Flex
                      key={item.actionId}
                      py={3}
                      align="center"
                      justify="space-between"
                      gap={3}
                      borderBottomWidth="1px"
                      borderColor="gray.100"
                    >
                      <Box minW={0}>
                        <Text fontWeight={500}>
                          {operationLabel(item.operation)}
                        </Text>
                        {buyerBondLabel(item) && (
                          <Text fontSize="sm">
                            Price {amountLabel(item.price)} · Buyer bond{' '}
                            {buyerBondLabel(item)}
                          </Text>
                        )}
                        <Text color="muted" fontSize="sm">
                          {item.actionId.slice(-8)} · Attached{' '}
                          {amountLabel(item.amount)} · Fee cap{' '}
                          {amountLabel(item.maxFee || '0')}
                          {item.submitted && ` · ${item.submitted.status}`}
                          {item.pinChanged && ' · Previous deployment'}
                          {item.attempted &&
                            !item.submitted &&
                            ' · Sign attempt stopped'}
                        </Text>
                        {item.operation === 'buy' &&
                          item.submitted?.status === 'included' &&
                          !item.pinChanged && (
                            <Text color="muted" fontSize="sm">
                              Private purchase recorded. Verify the seller’s
                              ciphertext before confirming delivery.
                            </Text>
                          )}
                        {['list', 'relist'].includes(item.operation) &&
                          item.submitted?.status === 'included' &&
                          !item.pinChanged && (
                            <SecondaryButton
                              size="sm"
                              mt={2}
                              isDisabled={!canAct}
                              onClick={() => findSellerOrder(item.offerId)}
                            >
                              Find buyer order
                            </SecondaryButton>
                          )}
                        {item.operation === 'buyPublicSeed' &&
                          item.submitted?.status === 'included' && (
                            <Text color="muted" fontSize="sm">
                              Public seed purchase settled. Its keys were
                              already public.
                            </Text>
                          )}
                        {item.operation === 'buy' &&
                          !item.attempted &&
                          !item.pinChanged && (
                            <BundlePreview actionId={item.actionId} />
                          )}
                      </Box>
                      {!item.attempted && !item.pinChanged && (
                        <SecondaryButton
                          size="sm"
                          aria-label={`Review and send ${operationLabel(
                            item.operation
                          )}, action ${item.actionId.slice(-8)}`}
                          isDisabled={!canAct}
                          onClick={() =>
                            run('submit', {actionId: item.actionId})
                          }
                        >
                          Review and send
                        </SecondaryButton>
                      )}
                      {item.attempted && item.submitted?.txHash && (
                        <SecondaryButton
                          size="sm"
                          aria-label={`Check ${operationLabel(
                            item.operation
                          )}, action ${item.actionId.slice(-8)}`}
                          isDisabled={!canAct}
                          onClick={() =>
                            run('check', {actionId: item.actionId})
                          }
                        >
                          Check transaction
                        </SecondaryButton>
                      )}
                    </Flex>
                  ))}
                </Stack>
              </Box>
            </>
          )}
        </Box>
      </Page>
    </Layout>
  )
}
