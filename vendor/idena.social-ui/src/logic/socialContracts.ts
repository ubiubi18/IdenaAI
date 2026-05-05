export type SocialContractId = 'v11' | 'v10' | 'v9' | 'v5' | 'v1';

export type SocialContractOption = {
    id: SocialContractId,
    label: string,
    shortLabel: string,
    address: string,
    postIdPrefix: string,
    legacy: boolean,
};

export const SOCIAL_CONTRACTS: SocialContractOption[] = [
    {
        id: 'v11',
        label: 'Current contract v11',
        shortLabel: 'v11 current',
        address: '0x18b0a55eb99AcA113f50eEBbdeAf6f96E789277f',
        postIdPrefix: '',
        legacy: false,
    },
    {
        id: 'v10',
        label: 'Legacy contract v10',
        shortLabel: 'v10 legacy',
        address: '0xa1c5c1A8c6a1Af596078A5c9653F24c216fE1cb2',
        postIdPrefix: 'preV11:',
        legacy: true,
    },
    {
        id: 'v9',
        label: 'Legacy contract v9',
        shortLabel: 'v9 legacy',
        address: '0xc0324f3Cf8158D6E27dc0A07c221636056174718',
        postIdPrefix: 'preV10:',
        legacy: true,
    },
    {
        id: 'v5',
        label: 'Legacy contract v5',
        shortLabel: 'v5 legacy',
        address: '0xC5B35B4Dc4359Cc050D502564E789A374f634fA9',
        postIdPrefix: 'preV9:',
        legacy: true,
    },
    {
        id: 'v1',
        label: 'Legacy contract v1',
        shortLabel: 'v1 legacy',
        address: '0x8d318630eB62A032d2f8073d74f05cbF7c6C87Ae',
        postIdPrefix: 'preV5:',
        legacy: true,
    },
];

export const SOCIAL_CONTRACT_CURRENT = SOCIAL_CONTRACTS[0];

const normalizeAddress = (address?: string | null) => (address || '').toLowerCase();

export const getSocialContractById = (id?: string | null) =>
    SOCIAL_CONTRACTS.find((contract) => contract.id === id) || SOCIAL_CONTRACT_CURRENT;

export const getSocialContractByAddress = (address?: string | null) =>
    SOCIAL_CONTRACTS.find((contract) => normalizeAddress(contract.address) === normalizeAddress(address));

const knownPostIdPrefixes = SOCIAL_CONTRACTS
    .map((contract) => contract.postIdPrefix)
    .filter(Boolean);

export const stripKnownSocialPostIdPrefix = (postId?: string | null) => {
    const value = postId || '';
    const prefix = knownPostIdPrefixes.find((candidate) => value.startsWith(candidate));
    return prefix ? value.slice(prefix.length) : value;
};

export const normalizeSocialPostIdForContract = (
    postId: string | null | undefined,
    contractAddress: string,
) => {
    if (!postId) {
        return postId ?? null;
    }

    const contract = getSocialContractByAddress(contractAddress);
    if (!contract?.legacy) {
        return postId;
    }

    return stripKnownSocialPostIdPrefix(postId);
};

export const normalizeSocialChannelIdForContract = (
    channelId: string | null | undefined,
    contractAddress: string,
) => {
    if (!channelId) {
        return channelId ?? null;
    }

    const contract = getSocialContractByAddress(contractAddress);
    if (!contract?.legacy) {
        return channelId;
    }

    return channelId.replace(
        /^(discuss:)(preV(?:5|9|10|11):)/,
        '$1',
    );
};
