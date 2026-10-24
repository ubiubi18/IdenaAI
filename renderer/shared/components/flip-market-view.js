/* eslint-disable react/prop-types */
import React from 'react'
import {
  Box,
  Flex,
  Grid,
  Heading,
  Text,
  Button,
  Image,
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalCloseButton,
  ModalBody,
  ModalFooter,
} from '@chakra-ui/react'
import {baseUnitsToIdna} from '../utils/fod-v7-amount'

function price(value) {
  const exact = baseUnitsToIdna(value)
  if (exact === null) return '—'
  const number = Number(exact)
  return `${number.toLocaleString('en-US', {maximumFractionDigits: 2})} iDNA`
}

function PriceHistory({history}) {
  const points = history.map((p) => ({
    ...p,
    value: Number(baseUnitsToIdna(p.price)),
  }))
  if (!points.length)
    return (
      <Text color="muted" fontSize="sm">
        No completed purchases yet.
      </Text>
    )
  const low = Math.min(...points.map((p) => p.value))
  const high = Math.max(...points.map((p) => p.value))
  const span = high - low || Math.max(high * 0.05, 1)
  const x = (i) =>
    points.length === 1 ? 320 : 70 + (i * 530) / (points.length - 1)
  const y = (v) => 110 - ((v - low) * 70) / span
  return (
    <Box maxW="3xl">
      <svg
        viewBox="0 0 640 145"
        role="img"
        aria-label="Recent completed purchase prices in iDNA per set"
        style={{width: '100%', maxHeight: 170}}
      >
        <line x1="70" y1="120" x2="600" y2="120" stroke="#CBD5E0" />
        <text x="5" y="40" fill="#718096" fontSize="12">
          {high.toFixed(2)}
        </text>
        <text x="5" y="112" fill="#718096" fontSize="12">
          {low.toFixed(2)}
        </text>
        <polyline
          points={points.map((p, i) => `${x(i)},${y(p.value)}`).join(' ')}
          fill="none"
          stroke="#578BFA"
          strokeWidth="3"
        />
        {points.map((p, i) => (
          <circle key={p.trade} cx={x(i)} cy={y(p.value)} r="5" fill="#578BFA">
            <title>{`Purchase ${p.trade}: ${price(p.price)}`}</title>
          </circle>
        ))}
        <text x="70" y="140" fill="#718096" fontSize="12">
          Purchase {points[0].trade}
        </text>
        {points.length > 1 && (
          <text x="600" y="140" textAnchor="end" fill="#718096" fontSize="12">
            Purchase {points[points.length - 1].trade}
          </text>
        )}
      </svg>
    </Box>
  )
}

export function MarketOverview({market}) {
  const offers = market.sells.filter(
    (s) => [1, 2].includes(s.state) && s.expires > market.height
  )
  const demand = market.buys.filter(
    (b) => b.state === 1 && b.expires > market.height
  )
  return (
    <Box
      as="section"
      aria-label="Market overview"
      mb={7}
      pb={6}
      borderBottomWidth="1px"
    >
      <Grid
        templateColumns={{base: '1fr', md: 'repeat(3, 1fr)'}}
        gap={5}
        mb={4}
      >
        <Box>
          <Text color="muted" fontSize="sm">
            Current price per set
          </Text>
          <Heading size="md" mt={1}>
            {price(market.buyQuote)}
          </Heading>
          <Text fontSize="sm" color="muted">
            Seller receives {price(market.sellQuote)}
          </Text>
        </Box>
        <Box>
          <Text color="muted" fontSize="sm">
            Available pool liquidity
          </Text>
          <Heading size="md" mt={1}>
            {price(market.reserve)}
          </Heading>
          <Text fontSize="sm" color="muted">
            {market.poolCanAcquire
              ? 'Pool can fund the next offer'
              : 'Next sale needs a matching buyer'}
          </Text>
        </Box>
        <Box>
          <Text color="muted" fontSize="sm">
            Supply and demand
          </Text>
          <Heading size="md" mt={1}>
            {offers.length} offers · {demand.length} buy orders
          </Heading>
          <Text fontSize="sm" color="muted">
            Prices follow the market curve
          </Text>
        </Box>
      </Grid>
      <Text fontWeight={500} fontSize="sm">
        Recent completed purchases · iDNA per set
      </Text>
      <PriceHistory history={market.priceHistory || []} />
      <Grid
        templateColumns={{base: '1fr', md: '1fr 1fr'}}
        gap={5}
        mt={4}
        fontSize="sm"
      >
        <Box>
          <Text fontWeight={500} mb={1}>
            Offers
          </Text>
          {offers.length ? (
            offers.map((s) => (
              <Text key={s.id}>
                Set #{s.id} · Seller minimum {price(s.minimum)}
              </Text>
            ))
          ) : (
            <Text color="muted">No sets currently offered.</Text>
          )}
        </Box>
        <Box>
          <Text fontWeight={500} mb={1}>
            Demand
          </Text>
          {demand.length ? (
            demand.map((b) => (
              <Text key={b.id}>
                Buy order #{b.id} · Up to {price(b.maximum)}
              </Text>
            ))
          ) : (
            <Text color="muted">No queued purchases.</Text>
          )}
        </Box>
      </Grid>
      <Text fontSize="sm" color="muted" mt={3}>
        Purchase escrow: {price(market.escrow)} · Security deposits:{' '}
        {price(market.stakes)}. Held separately from pool liquidity.
      </Text>
    </Box>
  )
}

export function PurchasedFlips({preview, onClose}) {
  const [index, setIndex] = React.useState(0)
  const flip = preview.flips[index]
  return (
    <Modal isOpen onClose={onClose} size="4xl" scrollBehavior="inside">
      <ModalOverlay />
      <ModalContent>
        <ModalHeader>
          Purchased set #{preview.trade} · Flip {index + 1} of {preview.count}
        </ModalHeader>
        <ModalCloseButton />
        <ModalBody>
          <Text color="muted" fontSize="sm" mb={4}>
            Epoch {preview.epoch} · Opened with your saved delivery key
          </Text>
          {flip.orders.map((order, sequence) => (
            <Box key={sequence} mb={4}>
              <Text fontWeight={500} mb={2}>
                Sequence {sequence === 0 ? 'A' : 'B'}
              </Text>
              <Grid templateColumns="repeat(4, minmax(0, 1fr))" gap={2}>
                {order.map((image, position) => (
                  <Image
                    key={position}
                    src={flip.images[image]}
                    alt={`Sequence ${sequence === 0 ? 'A' : 'B'}, image ${
                      position + 1
                    }`}
                    objectFit="contain"
                    width="100%"
                    height="17vh"
                    maxH="160px"
                    bg="gray.50"
                    borderRadius="md"
                  />
                ))}
              </Grid>
            </Box>
          ))}
        </ModalBody>
        <ModalFooter justifyContent="space-between">
          <Flex gap={3}>
            <Button
              isDisabled={index === 0}
              onClick={() => setIndex(index - 1)}
            >
              Previous flip
            </Button>
            <Button
              isDisabled={index + 1 === preview.count}
              onClick={() => setIndex(index + 1)}
            >
              Next flip
            </Button>
          </Flex>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}
