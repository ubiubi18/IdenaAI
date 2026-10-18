/* global BigInt */
/* eslint-disable react/prop-types */
import React from 'react'
import {
  Box,
  Button,
  Checkbox,
  Flex,
  FormControl,
  FormLabel,
  Heading,
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

const OPERATIONS = [
  ['buy', 'Buy private bundle'],
  ['buyPublicSeed', 'Buy public seed'],
  ['list', 'List private bundle'],
  ['confirm', 'Confirm verified delivery'],
  ['challenge', 'Challenge order'],
  ['startFallback', 'Start fallback'],
  ['proveAndReveal', 'Prove and reveal keys'],
  ['refund', 'Refund order'],
  ['relist', 'Relist bundle'],
  ['cancel', 'Cancel listing'],
  ['expireHead', 'Expire oldest offer'],
  ['topUpBond', 'Top up seller bond'],
  ['slashUnproved', 'Slash unproved order'],
  ['qualify', 'Qualify bundle'],
  ['proveBundle', 'Prove bundle content'],
  ['seedBundle', 'Publish public seed'],
  ['activate', 'Activate with 10,000 iDNA'],
  ['privateMessage', 'Create private ciphertext'],
  ['receive', 'Verify received ciphertext'],
]
const OFFER_OPERATIONS = new Set([
  'activate',
  'buy',
  'buyPublicSeed',
  'relist',
  'cancel',
  'expireHead',
  'topUpBond',
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
const BASE_UNITS = 10n ** 18n

function amountLabel(amount) {
  if (typeof amount !== 'string' || !/^(0|[1-9][0-9]*)$/.test(amount)) {
    return '—'
  }
  const whole = BigInt(amount) / BASE_UNITS
  const fraction = String(BigInt(amount) % BASE_UNITS)
    .padStart(18, '0')
    .replace(/0+$/, '')
  return `${whole}${fraction ? `.${fraction}` : ''} iDNA`
}

function resultOrThrow(response) {
  if (response?.error)
    throw new Error(response.error.message || 'V7 action refused.')
  if (!response?.result) throw new Error('V7 action returned no result.')
  return response.result
}

function Field({label, value, onChange, id, ...props}) {
  return (
    <FormControl>
      <FormLabel htmlFor={id}>{label}</FormLabel>
      <Input
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        autoComplete="off"
        {...props}
      />
    </FormControl>
  )
}

export default function FlipMarketV7({onSelectV4}) {
  const {offline, syncing} = useChainState()
  const {address} = useIdentityState()
  const {internalPort, url, useExternalNode} = useSettingsState()
  const [state, setState] = React.useState(null)
  const [loading, setLoading] = React.useState(true)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState('')
  const [notice, setNotice] = React.useState('')
  const [showConfig, setShowConfig] = React.useState(false)
  const [contract, setContract] = React.useState('')
  const [codeHash, setCodeHash] = React.useState('')
  const [binaryPath, setBinaryPath] = React.useState('')
  const [binarySha256, setBinarySha256] = React.useState('')
  const [operation, setOperation] = React.useState('buy')
  const [offerId, setOfferId] = React.useState('')
  const [orderId, setOrderId] = React.useState('')
  const [maxFee, setMaxFee] = React.useState('')
  const [minimumPayout, setMinimumPayout] = React.useState('')
  const [amount, setAmount] = React.useState('')
  const [passphrase, setPassphrase] = React.useState('')
  const [sealedFallback, setSealedFallback] = React.useState(false)
  const [purchaseActionId, setPurchaseActionId] = React.useState('')
  const requestRef = React.useRef(0)

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
        throw new Error('Saved v7 state could not be read.')
      }
      setState(next)
      setShowConfig(!next.configured)
    } catch (cause) {
      if (request === requestRef.current) setError(cause.message)
    } finally {
      if (request === requestRef.current) setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    setState(null)
    setNotice('')
    setError('')
    load()
    return () => {
      requestRef.current += 1
    }
  }, [address, internalPort, url, useExternalNode, load])

  const canAct = Boolean(address) && !offline && !syncing && !busy && !loading
  const savedBuys =
    state?.actions.filter((item) => item.operation === 'buy') || []

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
        setState(result)
        setShowConfig(false)
        setBinaryPath('')
        setBinarySha256('')
      } else if (method === 'prepare') {
        setNotice(
          `${successText} ${result.actionId}. Attached value: ${amountLabel(
            result.amount
          )}.`
        )
        await load()
      } else if (method === 'submit' || method === 'check') {
        const txStateLabel =
          {
            included: 'Included',
            failed: 'Failed on-chain',
          }[result.status] || 'Outcome uncertain'
        setNotice(
          result.status === 'cancelled'
            ? 'No transaction was signed.'
            : `${txStateLabel} · ${result.txHash || ''}`
        )
        await load()
      } else if (method === 'receive') {
        setNotice(
          `Verified ${result.usableFlips} original flips. ${
            result.folderOpened
              ? 'The private receipt and vault folder is open.'
              : 'Open the saved files from the app data folder.'
          }`
        )
      } else {
        setNotice(
          method === 'privateMessage' && !result.folderOpened
            ? 'Ciphertext saved locally. Open the saved files from the app data folder.'
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

  const configure = (event) => {
    event.preventDefault()
    run(
      'configure',
      {contract, codeHash, binaryPath, binarySha256},
      'Local deployment pin saved.'
    )
  }

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
        offerId,
        orderId,
        maxFee,
        minimumPayout,
        amount,
        ...(operation === 'startFallback' ? {sealedFallback} : {}),
        passphrase,
      },
      'Prepared v7 action'
    )
  }

  let prepareLabel = 'Choose files and prepare'
  if (operation === 'receive') prepareLabel = 'Verify delivery'
  else if (operation === 'privateMessage') prepareLabel = 'Save ciphertext'

  return (
    <Layout syncing={syncing} offline={offline}>
      <Page>
        <Box w="full" maxW="5xl">
          <Flex align="center" justify="space-between" gap={3} mb={5}>
            <Box>
              <PageTitle mb={0}>Direct v7</PageTitle>
              <Text color="muted" fontSize="sm">
                Experimental contract actions through your local node
              </Text>
            </Box>
            <Flex gap={2}>
              <SecondaryButton onClick={onSelectV4}>Direct v4</SecondaryButton>
              <SecondaryButton onClick={load} isLoading={loading}>
                Refresh
              </SecondaryButton>
            </Flex>
          </Flex>

          {offline && (
            <Text color="muted" mb={4}>
              Connect your node to use v7.
            </Text>
          )}
          {!address && (
            <Text color="muted" mb={4}>
              Select an identity to use v7.
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
            <Box as="section" aria-label="Local v7 deployment pin" mb={9}>
              <Heading as="h2" fontSize="lg" fontWeight={500} mb={2}>
                Local deployment pin
              </Heading>
              <Text color="muted" fontSize="sm" mb={4}>
                Enter the independently verified deployment and SHA-256 of your
                locally built v7 CLI. These values stay in this app’s local
                data.
              </Text>
              <Box as="form" onSubmit={configure} maxW="lg">
                <Stack spacing={3}>
                  <Field
                    id="v7-contract"
                    label="Contract address"
                    value={contract}
                    onChange={setContract}
                    isDisabled={!canAct}
                  />
                  <Field
                    id="v7-code-hash"
                    label="Deployed code hash"
                    value={codeHash}
                    onChange={setCodeHash}
                    isDisabled={!canAct}
                  />
                  <Field
                    id="v7-binary"
                    label="Local v7 CLI path"
                    value={binaryPath}
                    onChange={setBinaryPath}
                    isDisabled={!canAct}
                  />
                  <Field
                    id="v7-binary-hash"
                    label="CLI SHA-256"
                    value={binarySha256}
                    onChange={setBinarySha256}
                    isDisabled={!canAct}
                  />
                  <PrimaryButton
                    type="submit"
                    isLoading={busy}
                    isDisabled={
                      !canAct ||
                      !contract ||
                      !codeHash ||
                      !binaryPath ||
                      !binarySha256
                    }
                  >
                    Verify and save pin
                  </PrimaryButton>
                </Stack>
              </Box>
            </Box>
          )}

          {state?.configured && (
            <>
              <Box as="section" aria-label="V7 action" mb={10}>
                <Heading as="h2" fontSize="lg" fontWeight={500} mb={4}>
                  Prepare an action
                </Heading>
                <Box as="form" onSubmit={prepare} maxW="lg">
                  <Stack spacing={4}>
                    <FormControl>
                      <FormLabel htmlFor="v7-operation">Action</FormLabel>
                      <Select
                        id="v7-operation"
                        value={operation}
                        onChange={(event) => setOperation(event.target.value)}
                        isDisabled={!canAct}
                      >
                        {OPERATIONS.map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </Select>
                    </FormControl>
                    {OFFER_OPERATIONS.has(operation) && (
                      <Field
                        id="v7-offer"
                        label="Offer ID (64 hex characters)"
                        value={offerId}
                        onChange={setOfferId}
                        isDisabled={!canAct}
                      />
                    )}
                    {ORDER_OPERATIONS.has(operation) && (
                      <Field
                        id="v7-order"
                        label="Order ID"
                        value={orderId}
                        onChange={setOrderId}
                        isDisabled={!canAct}
                      />
                    )}
                    {operation === 'receive' && (
                      <FormControl>
                        <FormLabel htmlFor="v7-purchase">
                          Saved private purchase
                        </FormLabel>
                        <Select
                          id="v7-purchase"
                          value={purchaseActionId}
                          onChange={(event) =>
                            setPurchaseActionId(event.target.value)
                          }
                          isDisabled={!canAct}
                        >
                          <option value="">Choose purchase</option>
                          {savedBuys.map((item) => (
                            <option key={item.actionId} value={item.actionId}>
                              {item.actionId.slice(-8)} ·{' '}
                              {item.offerId.slice(0, 10)}…
                            </option>
                          ))}
                        </Select>
                      </FormControl>
                    )}
                    {!['privateMessage', 'receive'].includes(operation) && (
                      <Field
                        id="v7-fee"
                        label="Maximum fee (iDNA base units)"
                        value={maxFee}
                        onChange={setMaxFee}
                        inputMode="numeric"
                        isDisabled={!canAct}
                      />
                    )}
                    {['list', 'relist'].includes(operation) && (
                      <Field
                        id="v7-min-payout"
                        label="Minimum seller payout (base units, optional)"
                        value={minimumPayout}
                        onChange={setMinimumPayout}
                        inputMode="numeric"
                        isDisabled={!canAct}
                      />
                    )}
                    {operation === 'topUpBond' && (
                      <Field
                        id="v7-amount"
                        label="Bond top-up (base units)"
                        value={amount}
                        onChange={setAmount}
                        inputMode="numeric"
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
                        Include a v7 content proof for an unproved bundle
                      </Checkbox>
                    )}
                    {VAULT_OPERATIONS.has(operation) && (
                      <Field
                        id="v7-passphrase"
                        label="New or existing vault passphrase"
                        value={passphrase}
                        onChange={setPassphrase}
                        type="password"
                        isDisabled={!canAct}
                      />
                    )}
                    {FILE_OPERATIONS.has(operation) ||
                    (operation === 'startFallback' && sealedFallback) ? (
                      <Text fontSize="sm" color="muted">
                        The app will ask for the required local files. It does
                        not send private ciphertext for you.
                      </Text>
                    ) : null}
                    <PrimaryButton
                      type="submit"
                      isLoading={busy}
                      isDisabled={
                        !canAct ||
                        (OFFER_OPERATIONS.has(operation) && !offerId) ||
                        (ORDER_OPERATIONS.has(operation) && !orderId) ||
                        (operation === 'receive' && !purchaseActionId) ||
                        (VAULT_OPERATIONS.has(operation) && !passphrase) ||
                        (!['privateMessage', 'receive'].includes(operation) &&
                          !maxFee)
                      }
                    >
                      {prepareLabel}
                    </PrimaryButton>
                  </Stack>
                </Box>
              </Box>

              <Box as="section" aria-label="Saved v7 actions">
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
                          {item.operation} · {amountLabel(item.amount)} attached
                        </Text>
                        <Text color="muted" fontSize="sm">
                          {item.actionId.slice(-8)} · Max fee{' '}
                          {amountLabel(item.maxFee || '0')}
                          {item.submitted && ` · ${item.submitted.status}`}
                          {item.attempted &&
                            !item.submitted &&
                            ' · Sign attempt stopped'}
                        </Text>
                      </Box>
                      {!item.attempted && (
                        <SecondaryButton
                          size="sm"
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
