import {beforeEach, describe, expect, it, vi} from 'vitest';
import {
    getPoster,
    getPosterWithIndexerApi,
    getPubkeyWithIdenaIndexerApi,
    getPubkeyWithRpc,
    type Poster,
} from './asyncUtils';
import {resolveMessagingRecipient} from './messageRecipients';

vi.mock('./asyncUtils', () => ({
    getPoster: vi.fn(),
    getPosterWithIndexerApi: vi.fn(),
    getPubkeyWithIdenaIndexerApi: vi.fn(),
    getPubkeyWithRpc: vi.fn(),
}));

const address = '0x0000000000000000000000000000000000000002';
const poster = {address, age: 1, pubkey: '', stake: '0', state: 'Human'};

describe('messaging recipient resolution', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('falls back to node RPC when the preferred indexer has no public key', async () => {
        vi.mocked(getPosterWithIndexerApi).mockResolvedValue({...poster});
        vi.mocked(getPubkeyWithIdenaIndexerApi).mockResolvedValue('');
        vi.mocked(getPubkeyWithRpc).mockResolvedValue('0x04recipient-public-key');

        const posters: Record<string, Poster> = {};
        const result = await resolveMessagingRecipient({
            address,
            posters,
            preferredSource: 'indexer-api',
            indexerApiUrl: 'https://api.idena.io',
            rpcClient: vi.fn(),
        });

        expect(result.error).toBe('');
        expect(result.recipient?.pubkey).toBe('0x04recipient-public-key');
        expect(posters[address]).toEqual(result.recipient);
        expect(getPubkeyWithIdenaIndexerApi).toHaveBeenCalledOnce();
        expect(getPubkeyWithRpc).toHaveBeenCalledOnce();
    });

    it('falls back to the indexer when RPC cannot find the identity', async () => {
        vi.mocked(getPoster).mockResolvedValue(undefined);
        vi.mocked(getPosterWithIndexerApi).mockResolvedValue({
            ...poster,
            pubkey: '0x04indexer-public-key',
        });

        const result = await resolveMessagingRecipient({
            address,
            posters: {},
            preferredSource: 'rpc',
            indexerApiUrl: 'https://api.idena.io',
            rpcClient: vi.fn(),
        });

        expect(result.error).toBe('');
        expect(result.recipient?.pubkey).toBe('0x04indexer-public-key');
        expect(getPoster).toHaveBeenCalledOnce();
        expect(getPosterWithIndexerApi).toHaveBeenCalledOnce();
    });

    it('reports a missing public key only after both sources were checked', async () => {
        vi.mocked(getPubkeyWithIdenaIndexerApi).mockResolvedValue('');
        vi.mocked(getPubkeyWithRpc).mockResolvedValue('');

        const result = await resolveMessagingRecipient({
            address,
            posters: {[address]: {...poster}},
            preferredSource: 'rpc',
            indexerApiUrl: 'https://api.idena.io',
            rpcClient: vi.fn(),
        });

        expect(result).toMatchObject({error: 'pubkey missing'});
        expect(getPubkeyWithRpc).toHaveBeenCalledOnce();
        expect(getPubkeyWithIdenaIndexerApi).toHaveBeenCalledOnce();
    });
});
