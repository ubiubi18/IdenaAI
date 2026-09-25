import {describe, expect, it, vi} from 'vitest';
import {Transaction} from 'idena-sdk-js-lite';
import {storeFileToIpfs, submitMessage, type RpcClient} from './asyncUtils';
// @ts-expect-error The desktop boundary is maintained in JavaScript.
import mainPolicy from '../../../../main/social-contract-call-policy.js';
// @ts-expect-error The renderer boundary is maintained in JavaScript.
import {validateSocialRpcRequest} from '../../../../renderer/shared/components/social-desktop-rpc-policy.js';

const sender = '0x0000000000000000000000000000000000000001';
const contract = '0x840e092e31e9656fF15E541505039ed77585338E';
const ciphertexts = ['c2VuZGVy', 'cmVjaXBpZW50'];
const messageHash = '11'.repeat(32);
const txHash = `0x${'22'.repeat(32)}`;
const feeTransaction = new Transaction({maxFee: '1000000000000000'}).toHex();

const send = (rpcClient: RpcClient) => submitMessage(
    sender, contract, 'sendMessage', ciphertexts, messageHash, 'rpc', rpcClient, '',
);

describe('desktop message submission', () => {
    it('accepts the real DM payload through both desktop gates after IPFS storage', async () => {
        const acceptedCalls: string[] = [];
        const rpcClient = vi.fn(async (method: string, params: any[]) => {
            const rendererError = validateSocialRpcRequest('message-test', method, params);
            if (rendererError) return {error: {message: rendererError}};
            if (method === 'contract_call') {
                const mainError = mainPolicy.validateSocialContractCall(params[0]);
                if (mainError) return {error: {message: mainError}};
                expect(params[0].amount).toBe(0.00002);
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
            if (method === 'bcn_getRawTx') return {result: feeTransaction};
            throw new Error(`Unexpected RPC method: ${method}`);
        });

        await expect(storeFileToIpfs(rpcClient, new Uint8Array([1, 2, 3]), sender)).resolves.toMatch(/^ipfs:\/\//);
        await expect(send(rpcClient)).resolves.toBe(txHash);
        expect(acceptedCalls).toEqual(['dna_storeToIpfs', 'contract_call']);
    });

    it('reports a rejected message transaction instead of resolving successfully', async () => {
        const rpcClient = vi.fn().mockResolvedValueOnce({result: feeTransaction})
            .mockResolvedValueOnce({error: {message: 'invalid_social_contract_call'}});
        await expect(send(rpcClient)).rejects.toThrow('invalid_social_contract_call');
    });

    it.each([{}, {result: null}, {result: 'not-a-transaction-hash'}])('requires a transaction hash for RPC success: %j', async (response) => {
        const rpcClient = vi.fn().mockResolvedValueOnce({result: feeTransaction})
            .mockResolvedValueOnce(response);
        await expect(send(rpcClient)).rejects.toThrow('The node did not accept the message transaction.');
    });
});
