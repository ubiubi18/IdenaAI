import {describe, expect, it, vi} from 'vitest';
import {storeFileToIpfs, submitMessage, type RpcClient} from './asyncUtils';
// @ts-expect-error The desktop boundary is maintained in JavaScript.
import mainPolicy from '../../../../main/social-contract-call-policy.js';
// @ts-expect-error The renderer boundary is maintained in JavaScript.
import {validateSocialRpcRequest} from '../../../../renderer/shared/components/social-desktop-rpc-policy.js';

const sender = '0x0000000000000000000000000000000000000001';
const contract = '0x840e092e31e9656fF15E541505039ed77585338E';
const ciphertexts = ['c2VuZGVy', 'cmVjaXBpZW50'];
const messageCiphertexts = (count: number) => Array.from(
    {length: count},
    (_, index) => ciphertexts[index] ?? btoa(`ciphertext ${index}`),
);
const messageHash = '11'.repeat(32);
const txHash = `0x${'22'.repeat(32)}`;
const estimateResult = {success: true, gasCost: '3.93125', txFee: '0.449038461538246'};

const send = (rpcClient: RpcClient, message = ciphertexts) => submitMessage(
    sender, contract, 'sendMessage', message, messageHash, 'rpc', rpcClient, '',
);

describe('desktop message submission', () => {
    it.each([2, 3, 6, 16])('accepts %i message ciphertexts through both desktop gates after IPFS storage', async (count) => {
        const acceptedCalls: string[] = [];
        const rpcClient = vi.fn(async (method: string, params: any[]) => {
            const rendererError = validateSocialRpcRequest('message-test', method, params);
            if (rendererError) return {error: {message: rendererError}};
            if (method === 'contract_estimateCall') {
                const mainError = mainPolicy.validateSocialContractCall(params[0]);
                if (mainError) return {error: {message: mainError}};
                expect(params[0].maxFee).toBe('10');
                acceptedCalls.push(method);
                return {result: estimateResult};
            }
            if (method === 'contract_call') {
                const mainError = mainPolicy.validateSocialContractCall(params[0]);
                if (mainError) return {error: {message: mainError}};
                expect(params[0].amount).toBe(0.00002);
                expect(params[0].maxFee).toBe('5.2563461538458952');
                acceptedCalls.push(method);
                return {result: txHash};
            }
            if (method === 'ipfs_add') return {result: 'Qm' + 'a'.repeat(44)};
            if (method === 'dna_getBalance') return {result: {mempoolNonce: 16}};
            if (method === 'dna_epoch') return {result: {epoch: 228}};
            if (method === 'dna_storeToIpfs') {
                acceptedCalls.push(method);
                return {result: `0x${'33'.repeat(32)}`};
            }
            throw new Error(`Unexpected RPC method: ${method}`);
        });

        await expect(storeFileToIpfs(rpcClient, new Uint8Array([1, 2, 3]), sender)).resolves.toMatch(/^ipfs:\/\//);
        await expect(send(rpcClient, messageCiphertexts(count))).resolves.toBe(txHash);
        expect(acceptedCalls).toEqual(['dna_storeToIpfs', 'contract_estimateCall', 'contract_call']);
    });

    it('accepts a realistic six-person envelope at the live network fee through both gates', async () => {
        const message = Array.from({length: 6}, () => btoa('a'.repeat(491)));
        const rpcClient = vi.fn(async (method: string, params: any[]) => {
            expect(validateSocialRpcRequest('realistic-group', method, params)).toBeNull();
            expect(mainPolicy.validateSocialContractCall(params[0])).toBeNull();
            if (method === 'contract_estimateCall') return {result: {
                success: true, gasCost: '8.1622115384576206', txFee: '4.039423076921138',
            }};
            expect(params[0].maxFee).toBe('14.64196153845451032');
            return {result: txHash};
        });
        await expect(send(rpcClient, message)).resolves.toBe(txHash);
    });

    it.each([0, 1, 17])('rejects %i message ciphertexts at preflight without submitting', async (count) => {
        const rpcClient = vi.fn(async (method: string, params: any[]) => {
            const rendererError = validateSocialRpcRequest('message-test', method, params);
            if (rendererError) return {error: {message: rendererError}};
            if (method === 'contract_estimateCall') {
                const mainError = mainPolicy.validateSocialContractCall(params[0]);
                return mainError ? {error: {message: mainError}} : {result: estimateResult};
            }
            throw new Error(`Unexpected RPC method: ${method}`);
        });

        await expect(send(rpcClient, messageCiphertexts(count))).rejects.toThrow('invalid_social_contract_call');
        expect(rpcClient.mock.calls.map(([method]) => method)).toEqual(['contract_estimateCall']);
    });

    it('reports a rejected message transaction instead of resolving successfully', async () => {
        const rpcClient = vi.fn().mockResolvedValueOnce({result: estimateResult})
            .mockResolvedValueOnce({error: {message: 'invalid_social_contract_call'}});
        await expect(send(rpcClient)).rejects.toThrow('invalid_social_contract_call');
    });

    it.each([{}, {result: null}, {result: 'not-a-transaction-hash'}])('requires a transaction hash for RPC success: %j', async (response) => {
        const rpcClient = vi.fn().mockResolvedValueOnce({result: estimateResult})
            .mockResolvedValueOnce(response);
        await expect(send(rpcClient)).rejects.toThrow('The node did not accept the message transaction.');
    });

    it('does not submit a message when the preflight fails', async () => {
        const rpcClient = vi.fn().mockResolvedValue({result: {success: false, error: 'message reverted'}});
        await expect(send(rpcClient)).rejects.toThrow('message reverted');
        expect(rpcClient.mock.calls.map(([method]) => method)).toEqual(['contract_estimateCall']);
    });

    it('does not submit a message whose estimated fee exceeds the desktop cap', async () => {
        const rpcClient = vi.fn().mockResolvedValue({result: {success: true, gasCost: '8.5', txFee: '0.1'}});
        await expect(send(rpcClient)).rejects.toThrow('The message exceeds the desktop fee limit of 10 IDNA.');
        expect(rpcClient.mock.calls.map(([method]) => method)).toEqual(['contract_estimateCall']);
    });
});
