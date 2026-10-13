import React from 'react'
import {
  Badge,
  Box,
  Button,
  Flex,
  FormControl,
  FormLabel,
  Heading,
  Input,
  Stack,
  Text,
} from '@chakra-ui/react'
import Layout from '../shared/components/layout'
import {Page, PageTitle} from '../shared/components/components'
import {PrimaryButton, SecondaryButton} from '../shared/components/button'
import {useChainState} from '../shared/providers/chain-context'
import {useIdentityState} from '../shared/providers/identity-context'
import {useSettingsState} from '../shared/providers/settings-context'

const DIRECT_VERSION = 4
const OFFER_ID = /^[0-9a-f]{64}$/
const PURCHASE_ID = /^fod-buy-[0-9a-f]{32}$/
const COMPLETE_STATUSES = ['funded', 'settled']
const LIST_STATUSES = [
  'included',
  'pending',
  'uncertain',
  'cancelled',
  'failed',
]
const PRICE_IDNA = /^(0|[1-9][0-9]*)(\.[0-9]{1,18})?$/
const BUY_STATUSES = [
  'funded',
  'settled',
  'included',
  'pending',
  'uncertain',
  'cancelled',
]

function formatIdna(baseUnits) {
  if (!/^(0|[1-9][0-9]*)$/.test(String(baseUnits))) return '—'
  const padded = String(baseUnits).padStart(19, '0')
  const whole = padded.slice(0, -18).replace(/^0+(?=[0-9])/, '')
  const fraction = padded.slice(-18).replace(/0+$/, '')
  return `${whole}${fraction ? `.${fraction}` : ''} iDNA`
}

function offerStatus(offer) {
  if (offer.retired) return 'Retired'
  if (String(offer.openOrderId) !== '0') return 'In purchase'
  return 'Available'
}

function purchaseStatus(status, orderId) {
  switch (status) {
    case 'funded':
      return orderId ? `Funded on-chain · Order ${orderId}` : 'Funded on-chain'
    case 'settled':
      return orderId
        ? `Settled on-chain · Order ${orderId}`
        : 'Settled on-chain'
    case 'included':
      return 'Included on-chain; identifying the order'
    case 'pending':
      return 'Pending on-chain'
    case 'uncertain':
      return 'Submission unverified; check its status before retrying'
    case 'cancelled':
      return 'Cancelled; prepared purchase saved'
    case 'failed':
      return 'Could not continue; purchase saved'
    default:
      return 'Saved purchase'
  }
}

function listingStatus(status) {
  switch (status) {
    case 'included':
      return 'Listing included on-chain.'
    case 'pending':
      return 'Listing pending on-chain.'
    case 'uncertain':
      return 'Submission unverified. Check this offer before trying again.'
    case 'cancelled':
      return 'Listing cancelled.'
    case 'failed':
      return 'Listing failed on-chain. You can retry.'
    default:
      return ''
  }
}

function resultOrThrow(response, fallback) {
  if (response?.error) throw new Error(response.error.message || fallback)
  if (!response?.result) throw new Error(fallback)
  return response.result
}

function sameAddress(left, right) {
  if (!left || !right) return false
  return (
    String(left).replace(/^0x/i, '').toLowerCase() ===
    String(right).replace(/^0x/i, '').toLowerCase()
  )
}

export default function FlipMarketPage() {
  const {offline, syncing} = useChainState()
  const {address} = useIdentityState()
  const {internalPort, url, useExternalNode} = useSettingsState()
  const [market, setMarket] = React.useState(null)
  const [marketLoading, setMarketLoading] = React.useState(true)
  const [marketError, setMarketError] = React.useState('')
  const [selectedOfferId, setSelectedOfferId] = React.useState(null)
  const [prepared, setPrepared] = React.useState(null)
  const [savedPurchaseIds, setSavedPurchaseIds] = React.useState([])
  const [savedLoading, setSavedLoading] = React.useState(true)
  const [savedError, setSavedError] = React.useState('')
  const [purchaseStates, setPurchaseStates] = React.useState({})
  const [purchaseError, setPurchaseError] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [sellPrice, setSellPrice] = React.useState('')
  const [sellPassphrase, setSellPassphrase] = React.useState('')
  const [listing, setListing] = React.useState(null)
  const [listingError, setListingError] = React.useState('')
  const [listingBusy, setListingBusy] = React.useState(false)
  const contextRef = React.useRef(0)
  const marketRequestRef = React.useRef(0)

  const loadMarket = React.useCallback(async () => {
    const context = contextRef.current
    marketRequestRef.current += 1
    const request = marketRequestRef.current
    if (offline) {
      setMarket(null)
      setMarketError('')
      setMarketLoading(false)
      return
    }
    setMarketLoading(true)
    setMarketError('')
    try {
      const result = resultOrThrow(
        await window.idena?.social?.directMarket?.({
          directVersion: DIRECT_VERSION,
        }),
        'Could not load offers from your node.'
      )
      if (
        result.format !== 'fod.direct-market-state' ||
        result.version !== 3 ||
        result.network !== 'idena' ||
        result.source !== 'node' ||
        !Array.isArray(result.offers) ||
        !Array.isArray(result.orders)
      ) {
        throw new Error('The market response could not be read.')
      }
      if (
        contextRef.current !== context ||
        marketRequestRef.current !== request
      )
        return
      setMarket(result)
      setSelectedOfferId((current) =>
        result.offers.some((offer) => offer.offerId === current)
          ? current
          : null
      )
    } catch (error) {
      if (
        contextRef.current !== context ||
        marketRequestRef.current !== request
      )
        return
      setMarket(null)
      setMarketError(error.message || 'Could not load offers from your node.')
    } finally {
      if (
        contextRef.current === context &&
        marketRequestRef.current === request
      )
        setMarketLoading(false)
    }
  }, [offline])

  const loadSaved = React.useCallback(async () => {
    const context = contextRef.current
    setSavedError('')
    setSavedLoading(true)
    try {
      const result = resultOrThrow(
        await window.idena?.social?.directBuyResume?.({}),
        'Could not load saved purchases.'
      )
      if (
        !Array.isArray(result.purchaseIds) ||
        !result.purchaseIds.every((id) => PURCHASE_ID.test(id)) ||
        result.purchaseIds[0] !== (result.purchaseId || undefined)
      ) {
        throw new Error('Saved purchases could not be read.')
      }
      if (contextRef.current === context)
        setSavedPurchaseIds((current) => [
          ...current.filter((id) => !result.purchaseIds.includes(id)),
          ...result.purchaseIds,
        ])
    } catch (error) {
      if (contextRef.current === context)
        setSavedError(error.message || 'Could not load saved purchases.')
    } finally {
      if (contextRef.current === context) setSavedLoading(false)
    }
  }, [])

  React.useEffect(() => {
    contextRef.current += 1
    marketRequestRef.current += 1
    setMarket(null)
    setSelectedOfferId(null)
    setPrepared(null)
    setSavedPurchaseIds([])
    setSavedLoading(!offline)
    setPurchaseStates({})
    setPurchaseError('')
    setBusy(false)
    setSellPrice('')
    setSellPassphrase('')
    setListing(null)
    setListingError('')
    setListingBusy(false)
    loadMarket()
    if (!offline) loadSaved()
    return () => {
      contextRef.current += 1
      marketRequestRef.current += 1
    }
  }, [
    address,
    internalPort,
    url,
    useExternalNode,
    offline,
    loadMarket,
    loadSaved,
  ])

  const selectedOffer = market?.offers.find(
    (offer) => offer.offerId === selectedOfferId
  )
  const myOrders =
    market?.orders?.filter((order) => sameAddress(order.buyer, address)) || []
  const canBuy = !offline && !syncing && !marketLoading && !busy
  const canSell = Boolean(address) && !offline && !syncing && !busy

  const listFlips = async (event, statusOnly = false) => {
    event?.preventDefault()
    if (!canSell) return
    const priceIdna =
      statusOnly && listing ? listing.priceIdna : sellPrice.trim()
    if (!PRICE_IDNA.test(priceIdna) || !/[1-9]/.test(priceIdna)) {
      setListingError('Enter a positive price in iDNA.')
      return
    }
    const passphraseLength = Array.from(sellPassphrase).length
    if (!statusOnly && (passphraseLength < 1 || passphraseLength > 512)) {
      setListingError('Enter the passphrase for this encrypted vault.')
      return
    }
    const context = contextRef.current
    setBusy(true)
    setListingBusy(true)
    if (!statusOnly) setListing(null)
    setListingError('')
    try {
      const request = window.idena?.social?.directList?.({
        priceIdna,
        passphrase: statusOnly ? '' : sellPassphrase,
      })
      setSellPassphrase('')
      const result = resultOrThrow(await request, 'Could not list flips.')
      if (
        !LIST_STATUSES.includes(result.status) ||
        !OFFER_ID.test(result.offerId) ||
        typeof result.priceIdna !== 'string' ||
        !PRICE_IDNA.test(result.priceIdna)
      )
        throw new Error('The listing status could not be read.')
      if (contextRef.current === context) {
        setListing(result)
        if (result.status === 'included') loadMarket()
      }
    } catch (error) {
      if (contextRef.current === context)
        setListingError(error.message || 'Could not list flips.')
    } finally {
      if (contextRef.current === context) {
        setSellPassphrase('')
        setListingBusy(false)
        setBusy(false)
      }
    }
  }

  const prepare = async () => {
    if (!selectedOffer || offerStatus(selectedOffer) !== 'Available' || !canBuy)
      return
    const context = contextRef.current
    setBusy(true)
    setPurchaseError('')
    setPrepared(null)
    try {
      const result = resultOrThrow(
        await window.idena?.social?.directBuyPrepare?.({
          directVersion: DIRECT_VERSION,
          offerId: selectedOffer.offerId,
        }),
        'Could not prepare this purchase.'
      )
      if (
        !PURCHASE_ID.test(result.purchaseId) ||
        !['priceIdna', 'bondIdna', 'totalIdna'].every((field) =>
          /^(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(result[field])
        )
      ) {
        throw new Error('The purchase summary could not be read.')
      }
      if (contextRef.current !== context) return
      setPrepared(result)
      setSavedPurchaseIds((current) => [
        result.purchaseId,
        ...current.filter((id) => id !== result.purchaseId),
      ])
    } catch (error) {
      if (contextRef.current === context)
        setPurchaseError(error.message || 'Could not prepare this purchase.')
    } finally {
      if (contextRef.current === context) setBusy(false)
    }
  }

  const continuePurchase = async (purchaseId) => {
    if (busy || offline || syncing || !PURCHASE_ID.test(purchaseId)) return
    const context = contextRef.current
    setBusy(true)
    setPurchaseError('')
    try {
      const result = resultOrThrow(
        await window.idena?.social?.directBuyCommit?.({purchaseId}),
        'Could not continue this purchase.'
      )
      if (
        result.purchaseId !== purchaseId ||
        !BUY_STATUSES.includes(result.status)
      )
        throw new Error('The purchase status could not be read.')
      if (contextRef.current === context) {
        setPurchaseStates((current) => ({...current, [purchaseId]: result}))
        if (COMPLETE_STATUSES.includes(result.status)) loadMarket()
      }
    } catch (error) {
      if (contextRef.current === context) {
        setPurchaseStates((current) => ({
          ...current,
          [purchaseId]: {status: 'failed'},
        }))
        setPurchaseError(error.message || 'Could not continue this purchase.')
      }
    } finally {
      if (contextRef.current === context) setBusy(false)
    }
  }

  let marketNotice = null
  if (offline) {
    marketNotice = (
      <Text color="muted" role="status">
        Your node is offline. Connect it to browse offers.
      </Text>
    )
  } else if (marketError) {
    marketNotice = (
      <Text color="red.500" role="alert">
        {marketError}
      </Text>
    )
  } else if (marketLoading && !market) {
    marketNotice = (
      <Text color="muted" role="status">
        Loading offers…
      </Text>
    )
  } else if (market?.offers.length === 0) {
    marketNotice = (
      <Text color="muted" role="status">
        No flip offers are available yet.
      </Text>
    )
  }

  let savedEmptyLabel = 'No saved purchases for this identity.'
  if (offline) savedEmptyLabel = 'Connect your node to see saved purchases.'
  else if (savedLoading) savedEmptyLabel = 'Loading saved purchases…'

  return (
    <Layout syncing={syncing} offline={offline}>
      <Page>
        <Box w="full" maxW="5xl">
          <Flex justify="space-between" align="center" mb={5} gap={4}>
            <Box>
              <PageTitle mb={0}>Flip market</PageTitle>
              <Text color="muted" fontSize="sm">
                Offers from your node
              </Text>
            </Box>
            <SecondaryButton onClick={loadMarket} isLoading={marketLoading}>
              Refresh
            </SecondaryButton>
          </Flex>

          {market && (
            <Text color="muted" fontSize="sm" mb={6} role="status">
              Observed at block {market.blockHeight} ·{' '}
              {new Date(market.observedAt).toLocaleString()}
            </Text>
          )}
          {marketNotice}

          <Box as="section" aria-label="Sell flips" mb={10} mt={6}>
            <Heading as="h2" fontSize="lg" fontWeight={500} mb={3}>
              Sell flips
            </Heading>
            <Box as="form" onSubmit={listFlips} maxW="sm">
              <Stack spacing={4}>
                <FormControl>
                  <FormLabel htmlFor="fod-list-price">Price (iDNA)</FormLabel>
                  <Input
                    id="fod-list-price"
                    type="text"
                    inputMode="decimal"
                    autoComplete="off"
                    value={sellPrice}
                    onChange={(event) => setSellPrice(event.target.value)}
                    isDisabled={!canSell}
                  />
                </FormControl>
                <FormControl>
                  <FormLabel htmlFor="fod-list-passphrase">
                    Vault passphrase
                  </FormLabel>
                  <Input
                    id="fod-list-passphrase"
                    type="password"
                    autoComplete="off"
                    value={sellPassphrase}
                    maxLength={512}
                    onChange={(event) => setSellPassphrase(event.target.value)}
                    isDisabled={!canSell}
                  />
                </FormControl>
                <Text color="orange.600" fontSize="sm">
                  Listing does not deliver keys to the buyer. Deliver them after
                  payment.
                </Text>
                {!address && (
                  <Text color="muted" fontSize="sm">
                    Select an identity to list flips.
                  </Text>
                )}
                <PrimaryButton
                  type="submit"
                  isLoading={listingBusy}
                  isDisabled={!canSell || !sellPrice.trim() || !sellPassphrase}
                >
                  Choose files and list
                </PrimaryButton>
                {listingError && (
                  <Text color="red.500" fontSize="sm" role="alert">
                    {listingError}
                  </Text>
                )}
                {listing && (
                  <Box role="status">
                    <Text fontSize="sm">{listingStatus(listing.status)}</Text>
                    {listing.status !== 'cancelled' && (
                      <Text
                        fontSize="sm"
                        fontFamily="mono"
                        wordBreak="break-all"
                      >
                        Offer {listing.offerId}
                      </Text>
                    )}
                    {['pending', 'uncertain'].includes(listing.status) && (
                      <SecondaryButton
                        type="button"
                        mt={2}
                        onClick={() => listFlips(null, true)}
                        isDisabled={!canSell}
                      >
                        Check listing
                      </SecondaryButton>
                    )}
                  </Box>
                )}
              </Stack>
            </Box>
          </Box>

          {market?.offers.length > 0 && (
            <Box as="section" aria-label="Flip offers" mb={10}>
              <Heading as="h2" fontSize="lg" fontWeight={500} mb={3}>
                Offers
              </Heading>
              <Stack spacing={0} borderTopWidth="1px" borderColor="gray.100">
                {market.offers.map((offer) => {
                  const status =
                    offerStatus(offer) === 'Available' &&
                    sameAddress(offer.author, address)
                      ? 'Your offer'
                      : offerStatus(offer)
                  return (
                    <Flex
                      key={offer.offerId}
                      py={4}
                      align="center"
                      justify="space-between"
                      gap={4}
                      borderBottomWidth="1px"
                      borderColor="gray.100"
                    >
                      <Box minW={0}>
                        <Flex align="center" gap={3} flexWrap="wrap">
                          <Text fontWeight={600}>
                            {formatIdna(offer.price)}
                          </Text>
                          <Badge
                            colorScheme={
                              status === 'Available' ? 'green' : 'gray'
                            }
                          >
                            {status}
                          </Badge>
                        </Flex>
                        <Text color="muted" fontSize="sm" mt={1}>
                          {offer.coveredFlips} flips · Epoch {offer.epoch} ·
                          Seller{' '}
                          <Box as="span" title={offer.author}>
                            {offer.author?.slice(0, 10)}…
                            {offer.author?.slice(-6)}
                          </Box>
                        </Text>
                      </Box>
                      <SecondaryButton
                        size="sm"
                        isDisabled={
                          !OFFER_ID.test(offer.offerId) ||
                          status !== 'Available' ||
                          marketLoading ||
                          busy ||
                          offline ||
                          syncing
                        }
                        onClick={() => {
                          setSelectedOfferId(offer.offerId)
                          setPrepared(null)
                          setPurchaseError('')
                        }}
                      >
                        {selectedOfferId === offer.offerId
                          ? 'Selected'
                          : 'Select'}
                      </SecondaryButton>
                    </Flex>
                  )
                })}
              </Stack>
            </Box>
          )}

          {selectedOffer && offerStatus(selectedOffer) === 'Available' && (
            <Box as="section" aria-label="Selected offer" mb={10}>
              <Heading as="h2" fontSize="lg" fontWeight={500} mb={2}>
                Selected offer
              </Heading>
              <Text color="muted" fontSize="sm" mb={4}>
                Choose the seller’s session bundle. The app checks that it
                matches this offer before saving a purchase.
              </Text>
              <SecondaryButton
                onClick={prepare}
                isLoading={busy}
                isDisabled={!canBuy}
              >
                Choose seller bundle
              </SecondaryButton>
              {prepared && (
                <Stack spacing={2} mt={5} maxW="sm">
                  <Flex justify="space-between">
                    <Text>Price</Text>
                    <Text>{prepared.priceIdna} iDNA</Text>
                  </Flex>
                  <Flex justify="space-between">
                    <Text>Refundable bond</Text>
                    <Text>{prepared.bondIdna} iDNA</Text>
                  </Flex>
                  <Flex
                    justify="space-between"
                    borderTopWidth="1px"
                    pt={2}
                    fontWeight={600}
                  >
                    <Text>Total</Text>
                    <Text>{prepared.totalIdna} iDNA</Text>
                  </Flex>
                  <Text color="muted" fontSize="sm">
                    {prepared.usableFlips} usable flips · Epoch {prepared.epoch}
                  </Text>
                  <PrimaryButton
                    mt={2}
                    onClick={() => continuePurchase(prepared.purchaseId)}
                    isLoading={busy}
                    isDisabled={
                      !canBuy ||
                      COMPLETE_STATUSES.includes(
                        purchaseStates[prepared.purchaseId]?.status
                      )
                    }
                  >
                    Continue to confirmation
                  </PrimaryButton>
                </Stack>
              )}
            </Box>
          )}

          {purchaseError && (
            <Text color="red.500" role="alert" mb={5}>
              {purchaseError}
            </Text>
          )}

          {market && (
            <Box as="section" aria-label="My orders" mb={10}>
              <Heading as="h2" fontSize="lg" fontWeight={500} mb={3}>
                My orders
              </Heading>
              {myOrders.length === 0 ? (
                <Text color="muted" fontSize="sm">
                  No orders for this identity.
                </Text>
              ) : (
                <Stack spacing={0} borderTopWidth="1px" borderColor="gray.100">
                  {myOrders.map((order) => (
                    <Box
                      key={order.orderId}
                      py={3}
                      borderBottomWidth="1px"
                      borderColor="gray.100"
                    >
                      <Text fontWeight={500}>
                        Order {order.orderId} ·{' '}
                        {order.keysPublic ? 'Keys public' : order.state}
                      </Text>
                      <Text color="muted" fontSize="sm">
                        Price {formatIdna(order.paid)} · Bond{' '}
                        {formatIdna(order.bond)}
                        {['funded', 'fallback-pending'].includes(order.state) &&
                          ` · Refund at block ${order.refundAtBlock}`}
                      </Text>
                    </Box>
                  ))}
                </Stack>
              )}
            </Box>
          )}

          <Box as="section" aria-label="Saved purchases">
            <Flex align="center" justify="space-between" mb={3} gap={4}>
              <Heading as="h2" fontSize="lg" fontWeight={500}>
                Saved purchases
              </Heading>
              <Button
                size="sm"
                variant="link"
                onClick={loadSaved}
                isDisabled={busy || offline}
              >
                Refresh saved
              </Button>
            </Flex>
            {savedError && (
              <Text color="red.500" role="alert" mb={3}>
                {savedError}
              </Text>
            )}
            {!savedError && savedPurchaseIds.length === 0 && (
              <Text color="muted" fontSize="sm">
                {savedEmptyLabel}
              </Text>
            )}
            <Stack
              spacing={0}
              borderTopWidth={savedPurchaseIds.length ? '1px' : 0}
              borderColor="gray.100"
            >
              {savedPurchaseIds.map((id) => {
                const result = purchaseStates[id]
                return (
                  <Flex
                    key={id}
                    py={3}
                    align="center"
                    justify="space-between"
                    gap={4}
                    borderBottomWidth="1px"
                    borderColor="gray.100"
                  >
                    <Box minW={0}>
                      <Text
                        fontSize="sm"
                        fontFamily="mono"
                        isTruncated
                        title={id}
                      >
                        Purchase · {id.slice(-8)}
                      </Text>
                      <Text color="muted" fontSize="sm" role="status">
                        {purchaseStatus(result?.status, result?.orderId)}
                      </Text>
                    </Box>
                    {!COMPLETE_STATUSES.includes(result?.status) && (
                      <SecondaryButton
                        size="sm"
                        onClick={() => continuePurchase(id)}
                        isLoading={busy}
                        isDisabled={busy || offline || syncing}
                      >
                        {result?.status === 'pending' ||
                        result?.status === 'included' ||
                        result?.status === 'uncertain'
                          ? 'Check status'
                          : 'Continue'}
                      </SecondaryButton>
                    )}
                  </Flex>
                )
              })}
            </Stack>
          </Box>
        </Box>
      </Page>
    </Layout>
  )
}
