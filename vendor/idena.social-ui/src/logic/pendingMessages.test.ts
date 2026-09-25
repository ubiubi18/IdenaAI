import {describe, expect, it, vi} from 'vitest';
import {sendPendingMessage, stageMessageFile, type PreparedMessage} from './pendingMessages';
import type {RpcClient} from './asyncUtils';

const from = '0x0000000000000000000000000000000000000001';
const contract = '0x840e092e31e9656fF15E541505039ed77585338E';
const cid1 = `Qm${'a'.repeat(44)}`;
const cid2 = `Qm${'b'.repeat(44)}`;
const storeTx1 = `0x${'11'.repeat(32)}`;
const storeTx2 = `0x${'22'.repeat(32)}`;
const messageTx = `0x${'33'.repeat(32)}`;
const message = ['c2VuZGVy', 'cmVjaXBpZW50'];
const messageHash = '44'.repeat(32);
const estimate = {result: {success: true, gasCost: '3.93125', txFee: '0.449038461538246'}};

const prepared = (cids: string[] = []): PreparedMessage => ({
    message,
    messageHash,
    uploads: cids.map(cid => ({cid})),
});

const memoryStorage = (values = new Map<string, string>()) => ({
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
});

const saved = (values: Map<string, string>, key: string) => JSON.parse(values.get(key)!);

const makeOptions = (
    key: string,
    storage: ReturnType<typeof memoryStorage>,
    rpcClient: RpcClient,
    prepare: () => Promise<PreparedMessage>,
) => ({key, storage, from, contract, method: 'sendMessage', rpcClient, prepare, confirmFee: vi.fn(async () => true)});

const defaultResponse = (method: string) => {
    if (method === 'contract_estimateCall') return estimate;
    if (method === 'dna_getBalance') return {result: {mempoolNonce: 16}};
    if (method === 'dna_epoch') return {result: {epoch: 228}};
    throw new Error(`Unexpected RPC method: ${method}`);
};

describe('pending desktop messages', () => {
    it('requires fee approval before any paid transaction and retains the prepared upload on cancellation', async () => {
        const values = new Map<string, string>();
        const rpcClient = vi.fn(async (method: string) => defaultResponse(method));
        const options = makeOptions('declined-fee', memoryStorage(values), rpcClient, async () => prepared([cid1]));
        options.confirmFee = vi.fn(async () => false);
        await expect(sendPendingMessage(options)).rejects.toThrow('Cancelled');
        expect(options.confirmFee).toHaveBeenCalledWith('5.2563461538458952', 1);
        expect(rpcClient.mock.calls.map(([method]) => method)).toEqual(['contract_estimateCall']);
        expect(saved(values, options.key).uploads).toEqual([{cid: cid1}]);
    });

    it('retains paid storage if the fee rises above the approved cap before the message call', async () => {
        const values = new Map<string, string>();
        let estimates = 0;
        const rpcClient = vi.fn(async (method: string) => {
            if (method === 'contract_estimateCall') return ++estimates === 1 ? estimate
                : {result: {success: true, gasCost: '5', txFee: '1'}};
            if (method === 'dna_storeToIpfs') return {result: storeTx1};
            return defaultResponse(method);
        });
        const options = makeOptions('increased-fee', memoryStorage(values), rpcClient, async () => prepared([cid1]));
        await expect(sendPendingMessage(options)).rejects.toThrow('fee increased');
        expect(options.confirmFee).toHaveBeenCalledWith('5.2563461538458952', 1);
        expect(rpcClient.mock.calls.map(([method]) => method)).not.toContain('contract_call');
        expect(saved(values, options.key).uploads[0]).toMatchObject({cid: cid1, txHash: storeTx1});
    });

    it('stages an encrypted file but spends nothing when preflight rejects the message', async () => {
        const values = new Map<string, string>();
        const storage = memoryStorage(values);
        const rpcClient = vi.fn(async (method: string, params: any[]) => {
            if (method === 'ipfs_add') {
                expect(params[1]).toBe(true);
                return {result: cid1};
            }
            if (method === 'contract_estimateCall') return {result: {success: false, error: 'message reverted'}};
            return defaultResponse(method);
        });
        const prepare = vi.fn(async () => prepared([await stageMessageFile(rpcClient, new Uint8Array([1, 2, 3]))]));

        await expect(sendPendingMessage(makeOptions('preflight', storage, rpcClient, prepare))).rejects.toThrow('message reverted');
        expect(rpcClient.mock.calls.map(([method]) => method)).toEqual(['ipfs_add', 'contract_estimateCall']);
        expect(saved(values, 'preflight')).toMatchObject({message, messageHash, uploads: [{cid: cid1}]});
    });

    it('keeps paid storage and ciphertexts after an explicit call rejection for a fresh-wrapper retry', async () => {
        const key = 'retry-one-upload';
        const values = new Map<string, string>();
        const prepare = vi.fn(async () => prepared([cid1]));
        let callAttempts = 0;
        const rpcClient = vi.fn(async (method: string, _params: any[]) => {
            if (method === 'dna_storeToIpfs') return {result: storeTx1};
            if (method === 'contract_call') {
                callAttempts++;
                return callAttempts === 1
                    ? {error: {code: -32000, message: 'contract rejected'}}
                    : {result: messageTx};
            }
            return defaultResponse(method);
        });

        await expect(sendPendingMessage(makeOptions(key, memoryStorage(values), rpcClient, prepare))).rejects.toThrow('contract rejected');
        expect(saved(values, key)).toMatchObject({
            message, messageHash, submitting: false,
            uploads: [{cid: cid1, txHash: storeTx1, submitting: false}],
        });

        await expect(sendPendingMessage(makeOptions(key, memoryStorage(values), rpcClient, prepare))).resolves.toBe(messageTx);
        expect(prepare).toHaveBeenCalledTimes(1);
        expect(rpcClient.mock.calls.filter(([method]) => method === 'dna_storeToIpfs')).toHaveLength(1);
        expect(rpcClient.mock.calls.filter(([method]) => method === 'contract_call')
            .map(([, params]) => JSON.parse(params[0].args[0].value).message)).toEqual([message, message]);
        expect(saved(values, key)).toMatchObject({txHash: messageTx, submitting: false});
    });

    it('retries a rejected second upload without paying for the first again', async () => {
        const key = 'retry-second-upload';
        const values = new Map<string, string>();
        let secondAttempts = 0;
        const rpcClient = vi.fn(async (method: string, params: any[]) => {
            if (method === 'dna_storeToIpfs') {
                if (params[0].cid === cid1) return {result: storeTx1};
                secondAttempts++;
                return secondAttempts === 1
                    ? {error: {code: -32000, message: 'insufficient funds'}}
                    : {result: storeTx2};
            }
            if (method === 'contract_call') return {result: messageTx};
            return defaultResponse(method);
        });
        const prepare = vi.fn(async () => prepared([cid1, cid2]));

        await expect(sendPendingMessage(makeOptions(key, memoryStorage(values), rpcClient, prepare))).rejects.toThrow('insufficient funds');
        expect(saved(values, key).uploads).toMatchObject([
            {cid: cid1, txHash: storeTx1, submitting: false},
            {cid: cid2, submitting: false},
        ]);

        await expect(sendPendingMessage(makeOptions(key, memoryStorage(values), rpcClient, prepare))).resolves.toBe(messageTx);
        expect(rpcClient.mock.calls.filter(([method]) => method === 'dna_storeToIpfs')
            .map(([, params]) => params[0].cid)).toEqual([cid1, cid2, cid2]);
        expect(prepare).toHaveBeenCalledTimes(1);
    });

    it('coalesces concurrent attempts for the same pending message', async () => {
        const key = 'concurrent';
        const values = new Map<string, string>();
        let completeCall!: (response: {result: string}) => void;
        const deferredCall = new Promise<{result: string}>(resolve => { completeCall = resolve; });
        const rpcClient = vi.fn(async (method: string) => {
            if (method === 'contract_call') return deferredCall;
            return defaultResponse(method);
        });
        const prepare = vi.fn(async () => prepared());
        const options = makeOptions(key, memoryStorage(values), rpcClient, prepare);

        const first = sendPendingMessage(options);
        const second = sendPendingMessage(options);
        expect(second).toBe(first);
        await vi.waitFor(() => expect(rpcClient.mock.calls.filter(([method]) => method === 'contract_call')).toHaveLength(1));
        completeCall({result: messageTx});
        await expect(first).resolves.toBe(messageTx);
        expect(prepare).toHaveBeenCalledTimes(1);
    });

    it.each([
        ['transport failure', async () => { throw new Error('connection lost'); }],
        ['empty outcome', async () => ({})],
    ] as const)('blocks duplicate message submission after an uncertain %s', async (_name, outcome) => {
        const key = `uncertain-call-${_name}`;
        const values = new Map<string, string>();
        const rpcClient = vi.fn(async (method: string) => {
            if (method === 'contract_call') return outcome();
            return defaultResponse(method);
        });
        const options = makeOptions(key, memoryStorage(values), rpcClient, async () => prepared());

        await expect(sendPendingMessage(options)).rejects.toThrow('unknown outcome');
        expect(saved(values, key).submitting).toBe(true);
        const callsBeforeRetry = rpcClient.mock.calls.length;
        await expect(sendPendingMessage(makeOptions(key, memoryStorage(values), rpcClient, async () => prepared()))).rejects.toThrow('unknown outcome');
        expect(rpcClient.mock.calls).toHaveLength(callsBeforeRetry);
    });

    it('blocks duplicate storage after an empty storage outcome', async () => {
        const key = 'uncertain-storage';
        const values = new Map<string, string>();
        const rpcClient = vi.fn(async (method: string) => {
            if (method === 'dna_storeToIpfs') return {};
            return defaultResponse(method);
        });
        const options = makeOptions(key, memoryStorage(values), rpcClient, async () => prepared([cid1]));

        await expect(sendPendingMessage(options)).rejects.toThrow('unknown outcome');
        expect(saved(values, key).uploads[0]).toMatchObject({cid: cid1, submitting: true});
        const callsBeforeRetry = rpcClient.mock.calls.length;
        await expect(sendPendingMessage(makeOptions(key, memoryStorage(values), rpcClient, async () => prepared([cid1])))).rejects.toThrow('unknown outcome');
        expect(rpcClient.mock.calls).toHaveLength(callsBeforeRetry);
    });

    it('makes no paid calls when pending storage cannot be written', async () => {
        const storage = {
            getItem: (_key: string) => null,
            setItem: (_key: string, _value: string) => { throw new Error('storage unavailable'); },
            removeItem: (_key: string) => {},
        };
        const rpcClient = vi.fn(async (method: string) => defaultResponse(method));
        const prepare = vi.fn(async () => prepared([cid1]));

        await expect(sendPendingMessage(makeOptions('unavailable-storage', storage, rpcClient, prepare)))
            .rejects.toThrow('Could not save the pending message');
        expect(rpcClient).not.toHaveBeenCalled();
    });
});
