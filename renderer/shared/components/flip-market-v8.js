/* global BigInt */
/* eslint-disable react/prop-types */
import React from 'react'
import {
  Box,
  Button,
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
import {MarketOverview, PurchasedFlips} from './flip-market-view'
import {Page, PageTitle} from './components'
import {PrimaryButton, SecondaryButton} from './button'
import {baseUnitsToIdna, idnaToBaseUnits} from '../utils/fod-v7-amount'
import {useChainState} from '../providers/chain-context'
import {useIdentityState} from '../providers/identity-context'

const labels = {
  depositStake: 'Add security stake',
  withdrawStake: 'Withdraw stake',
  addReserve: 'Contribute to the pool',
  queueBuy: 'Join buy queue',
  queueSell: 'Join sell queue',
  matchNext: 'Match queued orders',
  acquire: 'Reserve pool payment',
  ready: 'Save encrypted flips',
  deliver: 'Deliver keys',
  accept: 'Verify and accept',
  challenge: 'Dispute delivery',
  expireTrade: 'Resolve expired trade',
  cancelBuy: 'Cancel purchase',
  cancelSell: 'Cancel sale',
  registerBundle: 'Register proven flips',
  proveDelivery: 'Submit delivery proof',
}
const tradeStates = {
  1: 'Saving encrypted flips',
  2: 'Waiting for private keys',
  3: 'Ready to verify',
  4: 'Delivery disputed',
  5: 'Completed',
  6: 'Refunded',
}
function money(value, compact = false) {
  const v = baseUnitsToIdna(value)
  if (compact && v?.includes('.') && v.split('.')[1].length > 4) {
    const [whole, fraction] = v.split('.')
    return `≈${whole}.${fraction.slice(0, 4)} iDNA`
  }
  return v === null ? '—' : `${v} iDNA`
}
function units(value) {
  const v = idnaToBaseUnits(value)
  if (!v || BigInt(v) <= 0n)
    throw new Error('Enter an amount greater than zero.')
  return v
}
async function marketCall(version, method, data) {
  const response = await window.idena?.social?.[`v${version}`]?.(method, data)
  if (response?.error || !response?.result)
    throw new Error(
      response?.error?.message || 'The local market is unavailable.'
    )
  return response.result
}
function Amount({label, value, setValue}) {
  return (
    <FormControl>
      <FormLabel>{label}</FormLabel>
      <Input
        value={value}
        inputMode="decimal"
        onChange={(e) => setValue(e.target.value)}
      />
    </FormControl>
  )
}
export default function FlipMarketV8({onLegacy, version = 8}) {
  const call = React.useCallback(
    (method, payload) => marketCall(version, method, payload),
    [version]
  )
  const {offline, syncing} = useChainState()
  const {address} = useIdentityState()
  const [data, setData] = React.useState(null)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState('')
  const [flow, setFlow] = React.useState('sell')
  const [maximum, setMaximum] = React.useState('')
  const [minimum, setMinimum] = React.useState('')
  const [capacity, setCapacity] = React.useState('')
  const [stakeAmount, setStakeAmount] = React.useState('')
  const [bundle, setBundle] = React.useState('')
  const [prepared, setPrepared] = React.useState(null)
  const [passphrase, setPassphrase] = React.useState('')
  const [details, setDetails] = React.useState(false)
  const [tradingSetup, setTradingSetup] = React.useState(false)
  const [packageImport, setPackageImport] = React.useState(false)
  const [perTrade, setPerTrade] = React.useState('')
  const [purchaseBudget, setPurchaseBudget] = React.useState(
    version === 9 ? '' : '150'
  )
  const [notice, setNotice] = React.useState('')
  const [purchased, setPurchased] = React.useState(null)
  const previewScope = React.useRef(0)
  const busyRef = React.useRef(false)
  const refresh = React.useCallback(async () => {
    const next = await call('status')
    setData(next)
    if (next.market) {
      const m = next.market
      const quotedCoverage = (BigInt(m.buyQuote) * 150n + 99n) / 100n
      const unit = 10n ** 18n
      const covered = ((quotedCoverage + unit - 1n) / unit) * unit
      const target =
        BigInt(m.account.target) > covered ? BigInt(m.account.target) : covered
      setMaximum(
        baseUnitsToIdna(((BigInt(m.buyQuote) * 105n + 99n) / 100n).toString())
      )
      setMinimum(
        baseUnitsToIdna(((BigInt(m.sellQuote) * 95n) / 100n || 1n).toString())
      )
      setCapacity(
        baseUnitsToIdna(
          (next.trading ? BigInt(next.trading.perTrade) : target).toString()
        )
      )
      setPerTrade(
        (v) =>
          v ||
          baseUnitsToIdna(((BigInt(m.buyQuote) * 105n + 99n) / 100n).toString())
      )
      setPurchaseBudget((v) => v || baseUnitsToIdna(target.toString()))
      setStakeAmount(
        (v) =>
          v ||
          baseUnitsToIdna(
            (target > BigInt(m.account.balance)
              ? target - BigInt(m.account.balance)
              : covered
            ).toString()
          )
      )
      setBundle((v) =>
        m.bundles.some(
          (b) =>
            b.id === v && b.author === m.identity && !b.used && b.sale === '0'
        )
          ? v
          : m.bundles.find(
              (b) => b.author === m.identity && !b.used && b.sale === '0'
            )?.id || ''
      )
    }
    return next
  }, [call])
  const run = React.useCallback(async (work) => {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    setError('')
    try {
      await work()
    } catch (e) {
      setError(e.message)
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }, [])
  React.useEffect(() => {
    previewScope.current += 1
    setPurchased(null)
    setPrepared(null)
    setData(null)
    setPerTrade('')
    setStakeAmount('')
    setBundle('')
    setPassphrase('')
    setFlow('sell')
    run(refresh)
    return () => {
      previewScope.current += 1
    }
  }, [address, refresh, run])
  React.useEffect(() => {
    const timer = setInterval(() => {
      if (!busyRef.current && !offline && !syncing)
        run(async () => {
          await refresh()
        })
    }, 30000)
    return () => clearInterval(timer)
  }, [offline, syncing, refresh, run])
  const market = data?.market
  const usable =
    market?.bundles.filter(
      (b) => b.author === market.identity && !b.used && b.sale === '0'
    ) || []
  const availableStake = market
    ? (BigInt(market.account.balance) < BigInt(market.account.target)
        ? BigInt(market.account.balance)
        : BigInt(market.account.target)) - BigInt(market.account.reserved)
    : 0n
  const eligible =
    market &&
    !market.account.needsTopup &&
    BigInt(market.account.balance) >= BigInt(market.account.target)
  const pending = (data?.actions || []).some(
    (a) => a.attempted && !['included', 'failed'].includes(a.submitted?.status)
  )
  const disabled = busy || offline || syncing || pending
  const firstVisit =
    market && market.account.balance === '0' && market.account.target === '0'
  const openOrders = market
    ? market.buys.some((b) => b.buyer === market.identity && b.state === 1) ||
      market.sells.some(
        (s) => s.seller === market.identity && [1, 2, 3].includes(s.state)
      ) ||
      market.trades.some((t) => t.state < 5) ||
      market.account.reserved !== '0'
    : false
  const buyReady = market?.sells.some(
    (s) =>
      [1, 2].includes(s.state) &&
      s.expires > market.height &&
      s.seller !== market.identity &&
      BigInt(s.capacity) >= BigInt(market.buyQuote) &&
      BigInt(s.minimum) <= BigInt(s.state === 2 ? s.proceeds : market.sellQuote)
  )
  const sellReady = market?.buys.some(
    (b) =>
      b.state === 1 &&
      b.expires > market.height &&
      b.buyer !== market.identity &&
      BigInt(b.maximum) >= BigInt(market.buyQuote)
  )
  let sellLabel = 'Join sell queue'
  let sellAvailability =
    'No funded buyer or pool payment. Your sale can wait in the queue.'
  if (market?.poolCanAcquire) {
    sellLabel = 'Sell to pool'
    sellAvailability =
      'The pool can reserve payment until a buyer verifies delivery.'
  }
  if (sellReady) {
    sellLabel = 'Sell now'
    sellAvailability = 'A compatible funded buyer is listed.'
  }
  const vaultReady = (data?.vaultBundles || []).includes(bundle)
  const buyLimit = BigInt(idnaToBaseUnits(maximum) || '0')
  const wallet = BigInt(
    idnaToBaseUnits(String(data?.walletBalance || '0')) || '0'
  )
  const buyBlocked =
    !data?.trading ||
    !eligible ||
    buyLimit <= 0n ||
    availableStake < buyLimit ||
    wallet <= buyLimit ||
    buyLimit > BigInt(data?.trading?.perTrade || '0') ||
    buyLimit > BigInt(data?.trading?.purchaseRemaining || '0')
  const sellBlocked =
    !data?.trading ||
    !eligible ||
    !bundle ||
    !vaultReady ||
    availableStake < BigInt(data?.trading?.perTrade || '0') ||
    BigInt(market?.buyQuote || '0') > BigInt(data?.trading?.perTrade || '0')
  const prepare = (operation, terms = {}) =>
    run(async () => {
      setPrepared(
        await call('prepare', {
          operation,
          ...terms,
          ...(['accept', 'deliver'].includes(operation) ? {passphrase} : {}),
        })
      )
    })
  const submit = () =>
    run(async () => {
      const result = await call('submit', {
        actionId: prepared.actionId,
        ...(version === 9 ? {passphrase} : {}),
      })
      if (result.status !== 'cancelled') {
        if (prepared.operation === 'depositStake') setFlow('sell')
        setPrepared(null)
        setStakeAmount('')
      }
      await refresh()
    })
  const placeOrder = (side) =>
    run(async () => {
      const result = await call('trade', {
        side,
        ...(side === 'sell' ? {bundle} : {}),
        quote: side === 'buy' ? market.buyQuote : market.sellQuote,
      })
      setNotice(
        result.status === 'included'
          ? 'Order confirmed. Matching and private delivery continue automatically.'
          : 'Order submitted. Waiting for confirmation before the next trade.'
      )
      await refresh()
    })
  const enableTrading = () =>
    run(async () => {
      const budget = idnaToBaseUnits(purchaseBudget)
      if (budget === null) throw new Error('Enter a valid purchase budget.')
      await call('unlock', {
        passphrase,
        perTrade: units(perTrade),
        purchaseBudget: budget,
      })
      setPassphrase('')
      await refresh()
    })
  const addStake = () =>
    run(async () => {
      const value = units(stakeAmount)
      const target =
        BigInt(market.account.balance) + BigInt(value) >
        BigInt(market.account.target)
          ? (BigInt(market.account.balance) + BigInt(value)).toString()
          : market.account.target
      setPrepared(
        await call('prepare', {
          operation: 'depositStake',
          amount: value,
          target,
        })
      )
    })
  let connectionLabel = 'Your flips, your local node'
  if (market)
    connectionLabel = `Connected · Block ${market.height} · Private delivery`
  if (syncing) connectionLabel = 'Node syncing'
  if (offline) connectionLabel = 'Node offline'
  return (
    <Layout>
      <Page>
        <Box maxW="960px" width="100%">
          <Flex justify="space-between" align="center" mb={2}>
            <PageTitle>Flips on Demand</PageTitle>
            <SecondaryButton onClick={() => run(refresh)} isDisabled={busy}>
              Refresh
            </SecondaryButton>
          </Flex>
          <Text color="muted" mb={8}>
            {connectionLabel}
          </Text>
          {error && (
            <Text role="alert" color="red.500" mb={5}>
              {error}
            </Text>
          )}
          {notice && (
            <Text role="status" mb={4}>
              {notice}
            </Text>
          )}
          {!data && !error && <Text role="status">Loading your market…</Text>}
          {data && !data.configured && (
            <Stack spacing={5} maxW="xl">
              <Heading as="h2" size="md">
                Bonded trading is awaiting activation
              </Heading>
              <Text>
                The new market adds stakes for both sides, private delivery and
                buyer and seller queues. Its connection will be remembered after
                activation.
              </Text>
              <Flex gap={3}>
                <PrimaryButton
                  isDisabled={disabled}
                  onClick={() =>
                    run(async () => {
                      await call('importProfile')
                      await refresh()
                    })
                  }
                >
                  Connect reviewed market
                </PrimaryButton>
                <SecondaryButton onClick={onLegacy}>
                  Open existing market
                </SecondaryButton>
              </Flex>
              <Text fontSize="sm" color="muted">
                The existing contract remains available with its original
                trading rules.
              </Text>
            </Stack>
          )}
          {market && (
            <>
              {market.trades.some(
                (t) => t.buyer === market.identity && t.state === 5
              ) && (
                <Box mb={6}>
                  <Heading size="sm" mb={3}>
                    Purchased flips
                  </Heading>
                  <Flex gap={3} wrap="wrap">
                    {market.trades
                      .filter(
                        (t) => t.buyer === market.identity && t.state === 5
                      )
                      .map((t) => (
                        <SecondaryButton
                          key={t.id}
                          isDisabled={busy || offline || syncing}
                          onClick={() =>
                            run(async () => {
                              const scope = previewScope.current
                              const result = await call('purchasedPreview', {
                                id: t.id,
                              })
                              if (scope === previewScope.current)
                                setPurchased(result)
                            })
                          }
                        >
                          View flips · Set #{t.id}
                        </SecondaryButton>
                      ))}
                  </Flex>
                </Box>
              )}
              <MarketOverview market={market} />
              {purchased && (
                <PurchasedFlips
                  preview={purchased}
                  onClose={() => setPurchased(null)}
                />
              )}
              {firstVisit ? (
                <Stack spacing={4} maxW="lg">
                  <Text color="muted" fontSize="sm">
                    1 · Security deposit → 2 · Start trading
                  </Text>
                  <Heading as="h2" size="md">
                    First, set up your security deposit
                  </Heading>
                  <Text fontSize="sm">
                    {data.currentFlips} current flips detected · {usable.length}{' '}
                    {version === 9
                      ? 'packages ready to sell'
                      : 'proven bundles ready to sell'}
                  </Text>
                  <Box>
                    <Heading as="h3" size="sm" mb={2}>
                      Protection for both sides
                    </Heading>
                    <Text>
                      Buyers and sellers keep a reusable deposit to cover open
                      trades. A settled dispute can deduct compensation.
                    </Text>
                  </Box>
                  <Box>
                    <Heading as="h3" size="sm" mb={2}>
                      Withdraw when you finish trading
                    </Heading>
                    <Text>
                      Close every queued order, trade and dispute first. Then
                      choose Finish trading &amp; withdraw deposit.
                    </Text>
                  </Box>
                  <Text fontSize="sm">
                    Curve per bundle: buy {money(market.buyQuote, true)} · sell{' '}
                    {money(market.sellQuote, true)}. An unmatched order waits in
                    the queue; pool sales need available pool funds.
                  </Text>
                  {!usable.length && (
                    <Text fontSize="sm" color="muted">
                      {version === 9
                        ? 'Selling requires a captured validation session and encrypted key vault.'
                        : 'Selling requires a completed validation and a registered bundle proof. Your current flips are not ready to sell.'}
                    </Text>
                  )}
                  <Amount
                    label="Your security deposit · iDNA"
                    value={stakeAmount}
                    setValue={setStakeAmount}
                  />
                  <Text fontSize="sm" color="muted">
                    Suggested from the current curve price, rounded up. Reuse
                    this deposit while trading. Purchases and network fees are
                    paid separately.
                  </Text>
                  <Text>
                    Wallet available:{' '}
                    {money(idnaToBaseUnits(data.walletBalance || '0'), true)}
                  </Text>
                  <PrimaryButton onClick={addStake} isDisabled={disabled}>
                    Review deposit
                  </PrimaryButton>
                </Stack>
              ) : (
                <>
                  <Flex justify="space-between" gap={4} wrap="wrap" mb={5}>
                    <Text>
                      {data.trading
                        ? 'Deposit ready · One-click trading enabled'
                        : 'Security deposit set up'}
                    </Text>
                    <Button
                      variant="link"
                      onClick={() => {
                        setFlow('stake')
                        setPrepared(null)
                      }}
                    >
                      Manage deposit
                    </Button>
                  </Flex>
                  <Flex gap={3} mb={6}>
                    {[
                      ['sell', 'Sell my flips'],
                      ['buy', 'Buy flips'],
                    ].map(([value, label]) => (
                      <Button
                        key={value}
                        variant={flow === value ? 'solid' : 'outline'}
                        onClick={() => {
                          setFlow(value)
                          setPrepared(null)
                        }}
                      >
                        {label}
                      </Button>
                    ))}
                  </Flex>
                </>
              )}
              {market.account.needsTopup && (
                <Box role="alert" p={4} bg="orange.50" borderRadius="md" mb={5}>
                  <Text>
                    New trades are paused. Refill your stake to{' '}
                    {money(market.account.target)} to continue. Existing trades
                    can still be resolved.
                  </Text>
                </Box>
              )}
              {!firstVisit && flow === 'buy' && (
                <Stack spacing={4} maxW="lg">
                  <Heading as="h2" size="md">
                    Buy at the curve price
                  </Heading>
                  <Text fontSize="2xl" fontWeight={500}>
                    {money(market.buyQuote)}
                  </Text>
                  <Text>
                    {buyReady
                      ? 'Matching supply is listed. The contract checks availability when matching.'
                      : 'No compatible flips available. Join the buy queue.'}
                  </Text>
                  <Text>Maximum payment: {money(buyLimit.toString())}</Text>
                  <Text fontSize="sm" color="muted">
                    The same amount is reserved from your deposit separately.
                    Price protection: 5%. Unmatched orders can be cancelled.
                  </Text>
                  <PrimaryButton
                    onClick={() => placeOrder('buy')}
                    isDisabled={disabled || buyBlocked}
                  >
                    {buyReady ? 'Buy now' : 'Join buy queue'}
                  </PrimaryButton>
                  {data.trading && buyBlocked && (
                    <Text role="status" fontSize="sm">
                      Check your available deposit, wallet balance and session
                      limits below before placing another order.
                    </Text>
                  )}
                </Stack>
              )}
              {!firstVisit && flow === 'sell' && (
                <Stack spacing={4} maxW="lg">
                  <Heading as="h2" size="md">
                    Your flips
                  </Heading>
                  <Text>
                    {data.currentFlips} flips detected for the current epoch ·{' '}
                    {usable.length}{' '}
                    {version === 9
                      ? 'packages ready to sell'
                      : 'proven bundles ready to sell'}
                  </Text>
                  {!usable.length ? (
                    <>
                      <Text color="muted">
                        {version === 9
                          ? 'Import the captured validation session and encrypted key vault. Your flips are checked locally before listing.'
                          : 'Current-epoch flips become eligible after their validation result is verified. Import an existing proof to register an earlier bundle.'}
                      </Text>
                      {version === 8 && (
                        <SecondaryButton
                          onClick={() =>
                            version === 9
                              ? run(async () => {
                                  await call('importPackage', {passphrase})
                                  await refresh()
                                })
                              : prepare('registerBundle')
                          }
                          isDisabled={disabled}
                        >
                          {version === 9
                            ? 'Import package'
                            : 'Register proven flips'}
                        </SecondaryButton>
                      )}
                    </>
                  ) : (
                    <>
                      {usable.length > 1 ? (
                        <FormControl>
                          <FormLabel>Bundle</FormLabel>
                          <Select
                            value={bundle}
                            onChange={(e) => setBundle(e.target.value)}
                          >
                            {usable.map((b) => (
                              <option key={b.id} value={b.id}>
                                Epoch {b.epoch} · {b.count} flips
                              </option>
                            ))}
                          </Select>
                        </FormControl>
                      ) : (
                        <Text>
                          Epoch {usable[0].epoch} · {usable[0].count} flips
                        </Text>
                      )}
                      <Text>Estimated proceeds before network fees</Text>
                      <Text fontSize="2xl" fontWeight={500}>
                        {money(market.sellQuote, true)}
                      </Text>
                      <Text>{sellAvailability}</Text>
                      <Text fontSize="sm" color="muted">
                        Minimum earnings: {money(idnaToBaseUnits(minimum))}.
                        Deposit reserved: {money(idnaToBaseUnits(capacity))}.
                        Payment is released after verified delivery.
                      </Text>
                      {!vaultReady && (
                        <>
                          <Text fontSize="sm">
                            Choose this bundle’s key vault once for this
                            session. Private delivery follows automatically
                            after matching.
                          </Text>
                          <SecondaryButton
                            isDisabled={disabled}
                            onClick={() =>
                              run(async () => {
                                await call('chooseVault', {bundle})
                                await refresh()
                              })
                            }
                          >
                            Choose epoch vault
                          </SecondaryButton>
                        </>
                      )}
                      <PrimaryButton
                        onClick={() => placeOrder('sell')}
                        isDisabled={disabled || sellBlocked}
                      >
                        {sellLabel}
                      </PrimaryButton>
                      {data.trading && sellBlocked && (
                        <Text role="status" fontSize="sm">
                          A selected vault and enough available deposit are
                          required. Check your session limits if the curve price
                          has moved.
                        </Text>
                      )}
                    </>
                  )}
                </Stack>
              )}
              {version === 9 && flow === 'sell' && (
                <Stack spacing={2} maxW="lg" mb={5}>
                  <Button
                    variant="link"
                    alignSelf="start"
                    aria-expanded={packageImport}
                    onClick={() => setPackageImport((value) => !value)}
                  >
                    Import package
                  </Button>
                  {packageImport && (
                    <>
                      <FormControl>
                        <FormLabel>Password for this saved package</FormLabel>
                        <Input
                          type="password"
                          value={passphrase}
                          onChange={(e) => setPassphrase(e.target.value)}
                        />
                      </FormControl>
                      <SecondaryButton
                        isDisabled={disabled || !passphrase}
                        onClick={() =>
                          run(async () => {
                            await call('importPackage', {passphrase})
                            await refresh()
                          })
                        }
                      >
                        Choose package files
                      </SecondaryButton>
                    </>
                  )}
                </Stack>
              )}
              {!firstVisit && flow === 'stake' && (
                <Stack spacing={4} maxW="lg">
                  <Heading as="h2" size="md">
                    Your security deposit
                  </Heading>
                  <Text>
                    {money(market.account.balance)} deposited ·{' '}
                    {money(market.account.reserved)} committed to orders
                  </Text>
                  <Text fontSize="sm" color="muted">
                    Both buyers and sellers reserve the full trade volume. A
                    dispute can reduce stake. Trading then pauses until the
                    required balance is restored.
                  </Text>
                  <Amount
                    label="Add to deposit"
                    value={stakeAmount}
                    setValue={setStakeAmount}
                  />
                  <PrimaryButton onClick={addStake} isDisabled={disabled}>
                    Review deposit
                  </PrimaryButton>
                  <Heading as="h3" size="sm" mt={5}>
                    Ready to finish trading?
                  </Heading>
                  <Text fontSize="sm">
                    Withdraw your full remaining deposit after all queued
                    orders, trades and disputes are closed. This ends one-click
                    trading.
                  </Text>
                  {openOrders && (
                    <Text role="status">
                      Your deposit is committed. Cancel unmatched orders or
                      finish open trades first.
                    </Text>
                  )}
                  <SecondaryButton
                    isDisabled={
                      disabled || openOrders || market.account.balance === '0'
                    }
                    onClick={() =>
                      prepare('withdrawStake', {
                        amount: market.account.balance,
                        exit: true,
                      })
                    }
                  >
                    Finish trading &amp; withdraw deposit
                  </SecondaryButton>
                </Stack>
              )}
              {!firstVisit && flow !== 'stake' && (
                <Box mt={8} maxW="lg">
                  <Button
                    variant="link"
                    mb={3}
                    aria-expanded={tradingSetup}
                    onClick={() => setTradingSetup((value) => !value)}
                  >
                    {data.trading
                      ? 'One-click trading limits'
                      : 'Set up one-click trading'}
                  </Button>
                  {tradingSetup &&
                    (!data.trading ? (
                      <Stack spacing={3}>
                        <Text fontSize="sm">
                          Approve limits once on this device. Each buy or sell
                          still starts with your click. Matching, private
                          delivery and verified acceptance then run while the
                          app is open.
                        </Text>
                        <Amount
                          label="Maximum per trade · iDNA"
                          value={perTrade}
                          setValue={setPerTrade}
                        />
                        <Amount
                          label="Total purchase budget · iDNA"
                          value={purchaseBudget}
                          setValue={setPurchaseBudget}
                        />
                        <FormControl>
                          <FormLabel>
                            {flow === 'buy'
                              ? 'Password for saved flip sets'
                              : 'Password for your saved package'}
                          </FormLabel>
                          <Input
                            type="password"
                            autoComplete="off"
                            minLength={12}
                            value={passphrase}
                            onChange={(e) => setPassphrase(e.target.value)}
                          />
                        </FormControl>
                        <Text fontSize="sm" color="muted">
                          {flow === 'buy'
                            ? 'Choose at least 12 characters to encrypt saved flip keys. Purchased flips open with the delivery key already on this device.'
                            : 'Enter the password used when your package was saved.'}
                        </Text>
                        <Text fontSize="sm" color="muted">
                          8 hours · Total network fee ceiling: 25 iDNA · Price
                          protection: 5%. Deposits, withdrawals and dispute
                          actions always need separate confirmation. Queued
                          orders remain active until filled, cancelled or
                          expired.
                        </Text>
                        <PrimaryButton
                          isDisabled={disabled || !eligible}
                          onClick={enableTrading}
                        >
                          Enable one-click trading
                        </PrimaryButton>
                      </Stack>
                    ) : (
                      <Stack spacing={2}>
                        <Text fontSize="sm">
                          Per trade: {money(data.trading.perTrade)} · Purchase
                          budget left: {money(data.trading.purchaseRemaining)}
                        </Text>
                        <Text fontSize="sm">
                          Network fee allowance left:{' '}
                          {money(data.trading.feeRemaining)} · Until{' '}
                          {new Date(data.trading.expires).toLocaleTimeString()}
                        </Text>
                        <Text fontSize="sm" color="muted">
                          Only orders you click. Keep the app open for delivery
                          and acceptance. Failed or uncertain signing attempts
                          also count against session limits.
                        </Text>
                        <Button
                          variant="link"
                          alignSelf="start"
                          isDisabled={busy}
                          onClick={() =>
                            run(async () => {
                              await call('stop')
                              await refresh()
                            })
                          }
                        >
                          Stop one-click trading
                        </Button>
                      </Stack>
                    ))}
                  {data.workerMessage && (
                    <Text role="status" mt={3} fontSize="sm">
                      {data.workerMessage}
                    </Text>
                  )}
                </Box>
              )}
              {prepared && (
                <Box
                  mt={6}
                  p={5}
                  borderWidth="1px"
                  borderRadius="md"
                  maxW="lg"
                  role="region"
                  aria-label="Review transaction"
                >
                  <Heading size="sm" mb={3}>
                    {labels[prepared.operation]}
                  </Heading>
                  <Text>Payment attached: {money(prepared.amount)}</Text>
                  <Text>Maximum network fee: {money(prepared.maxFee)}</Text>
                  {prepared.terms?.minimum && (
                    <Text>
                      Minimum earnings: {money(prepared.terms.minimum)}
                    </Text>
                  )}
                  {prepared.terms?.maximum && (
                    <Text>Maximum price: {money(prepared.terms.maximum)}</Text>
                  )}
                  <Flex mt={4} gap={3}>
                    <PrimaryButton onClick={submit} isDisabled={disabled}>
                      Continue to signing
                    </PrimaryButton>
                    <SecondaryButton
                      onClick={() => setPrepared(null)}
                      isDisabled={busy}
                    >
                      Cancel
                    </SecondaryButton>
                  </Flex>
                </Box>
              )}
              {!firstVisit && (
                <Box mt={10} pt={6} borderTopWidth="1px">
                  <Heading size="md" mb={4}>
                    My queue and trades
                  </Heading>
                  <Stack spacing={4}>
                    {market.buys
                      .filter(
                        (b) => b.buyer === market.identity && b.state === 1
                      )
                      .map((b) => (
                        <Flex key={`b${b.id}`} justify="space-between" gap={3}>
                          <Text>
                            Purchase queued · Up to {money(b.maximum)}
                          </Text>
                          <SecondaryButton
                            size="sm"
                            isDisabled={disabled}
                            onClick={() => prepare('cancelBuy', {id: b.id})}
                          >
                            Cancel
                          </SecondaryButton>
                        </Flex>
                      ))}
                    {market.sells
                      .filter(
                        (s) =>
                          s.seller === market.identity &&
                          [1, 2].includes(s.state)
                      )
                      .map((s) => (
                        <Flex key={`s${s.id}`} justify="space-between" gap={3}>
                          <Text>
                            {s.state === 2
                              ? `Payment reserved · ${money(
                                  s.proceeds
                                )} pending`
                              : 'Sale queued'}
                          </Text>
                          <SecondaryButton
                            size="sm"
                            isDisabled={disabled}
                            onClick={() => prepare('cancelSell', {id: s.id})}
                          >
                            Cancel
                          </SecondaryButton>
                        </Flex>
                      ))}
                    {market.trades.map((t) => {
                      const buyer = t.buyer === market.identity
                      const expired =
                        (t.state === 1 && market.height >= t.readyBy) ||
                        (t.state === 2 && market.height >= t.deliverBy) ||
                        ([3, 4].includes(t.state) && market.height >= t.proveBy)
                      return (
                        <Box key={t.id} py={3} borderBottomWidth="1px">
                          <Flex justify="space-between" gap={3} wrap="wrap">
                            <Box>
                              <Text fontWeight={500}>
                                {buyer ? 'Purchase' : 'Sale'} ·{' '}
                                {tradeStates[t.state]}
                              </Text>
                              <Text color="muted" fontSize="sm">
                                {money(buyer ? t.price : t.proceeds)}
                                {t.state < 5 ? ' pending' : ''}
                              </Text>
                            </Box>
                            <Flex gap={2} wrap="wrap">
                              {expired ? (
                                <SecondaryButton
                                  size="sm"
                                  isDisabled={disabled}
                                  onClick={() =>
                                    prepare('expireTrade', {id: t.id})
                                  }
                                >
                                  Resolve expired trade
                                </SecondaryButton>
                              ) : (
                                <>
                                  {buyer && t.state === 1 && (
                                    <SecondaryButton
                                      size="sm"
                                      isDisabled={disabled}
                                      onClick={() =>
                                        prepare('ready', {id: t.id})
                                      }
                                    >
                                      Save encrypted flips
                                    </SecondaryButton>
                                  )}
                                  {!buyer && t.state === 2 && (
                                    <SecondaryButton
                                      size="sm"
                                      isDisabled={disabled}
                                      onClick={() =>
                                        prepare('deliver', {id: t.id})
                                      }
                                    >
                                      Deliver keys
                                    </SecondaryButton>
                                  )}
                                  {buyer && [3, 4].includes(t.state) && (
                                    <PrimaryButton
                                      size="sm"
                                      isDisabled={disabled}
                                      onClick={() =>
                                        prepare('accept', {id: t.id})
                                      }
                                    >
                                      Verify and accept
                                    </PrimaryButton>
                                  )}
                                  {buyer && t.state === 3 && (
                                    <SecondaryButton
                                      size="sm"
                                      isDisabled={disabled}
                                      onClick={() =>
                                        prepare('challenge', {id: t.id})
                                      }
                                    >
                                      Report a problem
                                    </SecondaryButton>
                                  )}
                                  {!buyer &&
                                    (t.state === 4 ||
                                      (t.state === 3 &&
                                        market.height >= t.acceptBy)) && (
                                      <SecondaryButton
                                        size="sm"
                                        isDisabled={disabled}
                                        onClick={() =>
                                          prepare('proveDelivery', {id: t.id})
                                        }
                                      >
                                        Prove delivery
                                      </SecondaryButton>
                                    )}
                                </>
                              )}
                            </Flex>
                          </Flex>
                          {t.state === 4 && (
                            <Text mt={2} fontSize="sm">
                              Payment stays held during the dispute. The seller
                              can prove the original private delivery without
                              publishing keys.
                            </Text>
                          )}
                        </Box>
                      )
                    })}
                    {!market.trades.length &&
                      !market.buys.some((b) => b.buyer === market.identity) &&
                      !market.sells.some(
                        (s) => s.seller === market.identity
                      ) && (
                        <Text color="muted">
                          No queued orders or trades yet.
                        </Text>
                      )}
                  </Stack>
                </Box>
              )}
              {!firstVisit && (
                <Button
                  variant="link"
                  mt={8}
                  onClick={() => setDetails(!details)}
                >
                  {details ? 'Hide market details' : 'Market details'}
                </Button>
              )}
              {!firstVisit && details && (
                <Stack spacing={3} mt={4} fontSize="sm">
                  <Text>
                    Prices exclude network fees. Orders expire after 4,320
                    blocks. Neither queued deposits nor security stakes count as
                    pool liquidity.
                  </Text>
                  <Text>
                    Seller default: buyer payment refunded plus 10% compensation
                    from seller stake. A disproven complaint costs the buyer 5%,
                    plus proof reimbursement capped at 5%. Silence alone incurs
                    only the capped proof reimbursement.
                  </Text>
                  <Text>
                    Queued positions are processed in compatible arrival order.
                    Bundles have equal weight; no star premium or priority.
                  </Text>
                  <Flex gap={3}>
                    <SecondaryButton
                      size="sm"
                      onClick={() => prepare('matchNext')}
                      isDisabled={disabled}
                    >
                      Match next orders
                    </SecondaryButton>
                    <SecondaryButton
                      size="sm"
                      onClick={() => prepare('acquire')}
                      isDisabled={disabled}
                    >
                      Reserve next pool payment
                    </SecondaryButton>
                    <SecondaryButton size="sm" onClick={onLegacy}>
                      Existing market
                    </SecondaryButton>
                  </Flex>
                </Stack>
              )}
              {(data.actions || [])
                .filter(
                  (a) =>
                    a.attempted &&
                    !['included', 'failed'].includes(a.submitted?.status)
                )
                .map((a) => (
                  <Flex key={a.actionId} mt={4} gap={3} align="center">
                    <Text fontSize="sm">Transaction awaiting confirmation</Text>
                    <SecondaryButton
                      size="sm"
                      isDisabled={busy}
                      onClick={() =>
                        run(async () => {
                          await call('check', {actionId: a.actionId})
                          await refresh()
                        })
                      }
                    >
                      Check transaction
                    </SecondaryButton>
                  </Flex>
                ))}
            </>
          )}
        </Box>
      </Page>
    </Layout>
  )
}
