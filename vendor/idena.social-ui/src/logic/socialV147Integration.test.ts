import { afterEach, describe, expect, it, vi } from 'vitest';
import Decimal from 'decimal.js';
import { getDb } from './db';
import { getProfilePictureWithRpc, type Post } from './asyncUtils';
import { sendProfileCall } from './profileEdit';
import { getTopicFromChannelId, getTopicSummaries } from './topics';

afterEach(() => vi.unstubAllGlobals());

describe('embedded social v14.7 integration', () => {
    it('never opens persistent content storage in the embedded build', async () => {
        const indexedDbOpen = vi.fn();
        vi.stubGlobal('indexedDB', { open: indexedDbOpen });

        await expect(getDb()).resolves.toBeUndefined();
        expect(indexedDbOpen).not.toHaveBeenCalled();
    });

    it('counts only valid topic posts in the activity list', () => {
        expect(getTopicFromChannelId('r/idena')).toBe('idena');
        expect(getTopicFromChannelId('r/INVALID')).toBeUndefined();
        expect(getTopicFromChannelId('r/idena/extra')).toBeUndefined();

        const posts = {
            topic: { channelId: 'r/idena', timestamp: 10 },
            unrelated: { channelId: 'discuss:123', timestamp: 11 },
        } as unknown as Record<string, Post>;
        expect(getTopicSummaries(
            ['topic', 'unrelated'],
            { current: posts },
            { current: { topic: 20 } },
        )).toEqual([{ name: 'idena', posts: 1, lastActivity: 20 }]);
    });

    it('uses the bounded bridge request only inside the desktop frame', async () => {
        const cid = 'bafybeigdyrzt5sfp7udm7hu76uhc4b6xyc6vdzq3d2w3ym5udn2laq73aa';
        const rpcClient = vi.fn().mockResolvedValue({ result: undefined });
        vi.stubGlobal('window', { __IDENA_SOCIAL_DESKTOP_BOOTSTRAP__: { embeddedMode: 'desktop-onchain' } });

        await getProfilePictureWithRpc(rpcClient, `ipfs://${cid}`, '0x123');
        expect(rpcClient).toHaveBeenCalledWith('ipfs_getProfilePicture', [cid], true);

        vi.stubGlobal('window', { __IDENA_SOCIAL_DESKTOP_BOOTSTRAP__: {} });
        await getProfilePictureWithRpc(rpcClient, `ipfs://${cid}`, '0x123');
        expect(rpcClient).toHaveBeenLastCalledWith('ipfs_get', [cid], true);
    });

    it('refuses voucher payments before any profile transaction is sent', async () => {
        const rpcClient = vi.fn();
        const response = await sendProfileCall(
            rpcClient,
            '0x0000000000000000000000000000000000000001',
            { call: { method: 'dropName' }, amount: new Decimal(1), maxFee: new Decimal(2) },
            'rpc',
            'https://example.test/confirm',
            'https://app.idena.io',
        );
        expect(response.error).toMatch(/voucher payment/);
        expect(rpcClient).not.toHaveBeenCalled();
    });
});
