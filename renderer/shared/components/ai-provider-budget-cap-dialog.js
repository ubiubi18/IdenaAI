/* eslint-disable react/prop-types */
import React, {useEffect, useMemo, useState} from 'react'
import {Box, InputGroup, InputRightElement, Stack, Text} from '@chakra-ui/react'
import {useTranslation} from 'react-i18next'
import {PrimaryButton, SecondaryButton} from './button'
import {Dialog, DialogBody, DialogFooter, Input} from './components'
import {
  getMinimumAiProviderDailyBudgetUsd,
  getSuggestedAiProviderDailyBudgetUsd,
} from '../utils/ai-provider-budget'

function formatUsd(value) {
  const amount = Number(value)
  if (!Number.isFinite(amount) || amount < 0) {
    return '$0.00'
  }
  return `$${amount.toFixed(2)}`
}

export function AiProviderBudgetCapDialog({
  isOpen,
  onClose,
  status,
  onApprove,
  isLoading = false,
  contextLabel = '',
}) {
  const {t} = useTranslation()
  const minimumCapUsd = useMemo(
    () => getMinimumAiProviderDailyBudgetUsd(status),
    [status]
  )
  const suggestedCapUsd = useMemo(
    () => getSuggestedAiProviderDailyBudgetUsd(status),
    [status]
  )
  const [capInput, setCapInput] = useState('')
  const parsedCapUsd = Number(capInput)
  const canApprove =
    Number.isFinite(parsedCapUsd) &&
    parsedCapUsd > minimumCapUsd &&
    parsedCapUsd <= 10000 &&
    !isLoading

  useEffect(() => {
    if (isOpen) {
      setCapInput(suggestedCapUsd.toFixed(2))
    }
  }, [isOpen, suggestedCapUsd])

  const approve = () => {
    if (!canApprove) {
      return
    }
    onApprove(parsedCapUsd)
  }

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title={t('Approve higher AI budget')}
      shouldShowCloseButton={!isLoading}
    >
      <DialogBody>
        <Stack spacing={3}>
          {contextLabel ? <Text fontWeight={600}>{contextLabel}</Text> : null}
          <Box
            borderWidth="1px"
            borderColor="orange.200"
            borderRadius="md"
            bg="orange.012"
            p={3}
          >
            <Stack spacing={1}>
              <Text fontWeight={600} fontSize="sm">
                {t('Provider cost warning')}
              </Text>
              <Text color="muted" fontSize="sm">
                {t(
                  'This only raises the local IdenaAI guardrail. Your provider can still bill the API key. Use prepaid credits or a hard provider-side budget before approving a higher cap.'
                )}
              </Text>
            </Stack>
          </Box>
          <Stack spacing={1} fontSize="sm">
            <Text color="muted">
              {t('Used today')}: {formatUsd(status?.usage?.usd)}
            </Text>
            <Text color="muted">
              {t('Current daily cap')}: {formatUsd(status?.limitUsd)}
            </Text>
            <Text color="muted">
              {t('New cap must be above')}: {formatUsd(minimumCapUsd)}
            </Text>
          </Stack>
          <InputGroup>
            <Input
              type="number"
              min={Math.max(0.01, minimumCapUsd + 0.01)}
              step="0.5"
              value={capInput}
              onChange={(event) => setCapInput(event.target.value)}
              isDisabled={isLoading}
            />
            <InputRightElement w="9" color="muted" fontSize="xs">
              USD
            </InputRightElement>
          </InputGroup>
          {!canApprove ? (
            <Text color="red.500" fontSize="sm">
              {t(
                "Enter a new daily cap above today's current or projected spend."
              )}
            </Text>
          ) : null}
        </Stack>
      </DialogBody>
      <DialogFooter>
        <SecondaryButton onClick={onClose} isDisabled={isLoading}>
          {t('Cancel')}
        </SecondaryButton>
        <PrimaryButton onClick={approve} isDisabled={!canApprove}>
          {t('Approve new cap')}
        </PrimaryButton>
      </DialogFooter>
    </Dialog>
  )
}
