import {
    getPoster,
    getPosterWithIndexerApi,
    getPubkeyWithIdenaIndexerApi,
    getPubkeyWithRpc,
    type Poster,
    type RpcClient,
} from './asyncUtils';

type RecipientSource = 'rpc' | 'indexer-api';

type ResolveMessagingRecipientOptions = {
    address: string,
    posters: Record<string, Poster>,
    preferredSource: string,
    rpcClient: RpcClient,
    indexerApiUrl: string,
};

type ResolveMessagingRecipientResult = {
    recipient?: Poster,
    error: '' | 'not found' | 'pubkey missing',
};

const sourceOrder = (preferredSource: string): RecipientSource[] =>
    preferredSource === 'indexer-api'
        ? ['indexer-api', 'rpc']
        : ['rpc', 'indexer-api'];

export async function resolveMessagingRecipient({
    address,
    posters,
    preferredSource,
    rpcClient,
    indexerApiUrl,
}: ResolveMessagingRecipientOptions): Promise<ResolveMessagingRecipientResult> {
    const normalizedAddress = address.trim().toLowerCase();
    const sources = sourceOrder(preferredSource);
    let recipient: Poster | undefined = posters[normalizedAddress];

    if (!recipient) {
        for (const source of sources) {
            try {
                recipient = source === 'indexer-api'
                    ? await getPosterWithIndexerApi(indexerApiUrl, normalizedAddress)
                    : await getPoster(rpcClient, normalizedAddress, true);
            } catch {
                recipient = undefined;
            }

            if (recipient) {
                break;
            }
        }
    }

    if (!recipient) {
        return {error: 'not found'};
    }

    recipient = {
        ...recipient,
        address: normalizedAddress,
        pubkey: String(recipient.pubkey || '').trim(),
    };
    posters[normalizedAddress] = recipient;

    if (!recipient.pubkey) {
        for (const source of sources) {
            try {
                const pubkey = source === 'indexer-api'
                    ? await getPubkeyWithIdenaIndexerApi(indexerApiUrl, normalizedAddress)
                    : await getPubkeyWithRpc(rpcClient, normalizedAddress);

                if (pubkey) {
                    recipient = {...recipient, pubkey: String(pubkey).trim()};
                    posters[normalizedAddress] = recipient;
                    break;
                }
            } catch {
                // Continue with the other chain-backed lookup source.
            }
        }
    }

    return recipient.pubkey
        ? {recipient, error: ''}
        : {recipient, error: 'pubkey missing'};
}
