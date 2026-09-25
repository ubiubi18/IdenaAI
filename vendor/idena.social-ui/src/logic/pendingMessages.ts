import {getNonceAndEpoch, prepareRpcMessageCall, type RpcClient} from './asyncUtils';
import {toHexString} from 'idena-sdk-js-lite';
import Decimal from 'decimal.js';

export type PreparedMessage = {
    message: string[];
    messageHash: string;
    uploads: {cid: string; txHash?: string; submitting?: boolean}[];
};
type PendingMessage = PreparedMessage & {version: 1; submitting?: boolean; txHash?: string};
type PendingStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
type SendOptions = {
    key: string;
    storage: PendingStorage;
    from: string;
    contract: string;
    method: string;
    rpcClient: RpcClient;
    prepare: () => Promise<PreparedMessage>;
    confirmFee: (maxFee: string, remainingUploads: number) => Promise<boolean>;
};

const inFlight = new Map<string, Promise<string>>();
const isTxHash = (value: unknown): value is string => typeof value === 'string' && /^0x[0-9a-f]{64}$/i.test(value);
const uncertainMessage = 'A previous transaction submission has an unknown outcome. Check its status before sending again; the prepared message is saved.';
const isDefiniteRejection = (error: any) => Number.isInteger(error?.code) || [
    'invalid_social_contract_call', 'social_contract_caller_mismatch',
    'unsupported_rpc_method', 'invalid_rpc_params', 'rpc_payload_too_large',
].includes(error?.message);

export async function stageMessageFile(rpcClient: RpcClient, bytes: Uint8Array): Promise<string> {
    const response = await rpcClient('ipfs_add', [toHexString(bytes), true], true);
    if (response?.error || typeof response?.result !== 'string' || !response.result) {
        throw new Error(response?.error?.message || 'Could not prepare the encrypted IPFS file.');
    }
    return response.result;
}

function readPending(storage: PendingStorage, key: string): PendingMessage | null {
    const value = storage.getItem(key);
    if (!value) return null;
    const record = JSON.parse(value) as PendingMessage;
    if (record.version !== 1 || !Array.isArray(record.message) || record.message.length < 2 || record.message.length > 16 ||
        !record.message.every(ciphertext => typeof ciphertext === 'string' && /^[A-Za-z0-9+/]+={0,2}$/.test(ciphertext)) ||
        !/^[0-9a-f]{64}$/i.test(record.messageHash) || !Array.isArray(record.uploads) || record.uploads.length > 2 ||
        !record.uploads.every(upload => typeof upload.cid === 'string' && upload.cid.length > 0 && upload.cid.length <= 256 &&
            (upload.txHash === undefined || isTxHash(upload.txHash)) && (upload.submitting === undefined || typeof upload.submitting === 'boolean')) ||
        (record.txHash !== undefined && !isTxHash(record.txHash)) || (record.submitting !== undefined && typeof record.submitting !== 'boolean')) {
        throw new Error('The saved pending message is invalid. No transaction was submitted.');
    }
    return record;
}

async function sendPending({key, storage, from, contract, method, rpcClient, prepare, confirmFee}: SendOptions): Promise<string> {
    const save = (record: PendingMessage) => {
        try {
            storage.setItem(key, JSON.stringify(record));
        } catch {
            throw new Error('Could not save the pending message. No further transactions were submitted.');
        }
    };
    let pending = readPending(storage, key);
    if (!pending) {
        pending = {version: 1, ...await prepare()};
        // Only the recipient-encrypted envelope and upload references are saved.
        // Plaintext and the IPFS decryption keys are inside that envelope.
        save(pending);
    }
    if (pending.txHash) return pending.txHash;
    if (pending.submitting || pending.uploads.some(upload => upload.submitting && !upload.txHash)) {
        throw new Error(uncertainMessage);
    }

    // Exercise both desktop gates and the real contract before paying for storage.
    const approvedCall = await prepareRpcMessageCall(from, contract, method, pending.message, pending.messageHash, rpcClient);
    if (!await confirmFee(approvedCall.maxFee, pending.uploads.filter(upload => !upload.txHash).length)) {
        throw new Error('Cancelled. Your draft and prepared message are saved.');
    }
    for (const upload of pending.uploads) {
        if (upload.txHash) continue;
        const {nonce, epoch} = await getNonceAndEpoch(rpcClient, from);
        upload.submitting = true;
        save(pending);
        let response;
        try {
            response = await rpcClient('dna_storeToIpfs', [{cid: upload.cid, nonce, epoch}], true);
        } catch {
            throw new Error(uncertainMessage);
        }
        if (response?.error) {
            // Desktop transport failures cannot prove that the node rejected it.
            if (!isDefiniteRejection(response.error)) throw new Error(uncertainMessage);
            upload.submitting = false;
            save(pending);
            throw new Error(response.error.message || 'IPFS storage was rejected.');
        }
        if (!isTxHash(response?.result)) throw new Error(uncertainMessage);
        upload.txHash = response.result;
        upload.submitting = false;
        save(pending);
    }

    // Storage may have changed the nonce or network fees; refresh the estimate.
    const call = await prepareRpcMessageCall(from, contract, method, pending.message, pending.messageHash, rpcClient);
    if (new Decimal(call.maxFee).greaterThan(approvedCall.maxFee)) {
        throw new Error('The fee increased. Please review the new estimate and retry; completed storage is saved.');
    }
    call.maxFee = approvedCall.maxFee;
    pending.submitting = true;
    save(pending);
    let response;
    try {
        response = await rpcClient('contract_call', [call], true);
    } catch {
        throw new Error(uncertainMessage);
    }
    if (response?.error) {
        if (!isDefiniteRejection(response.error)) throw new Error(uncertainMessage);
        pending.submitting = false;
        save(pending);
        throw new Error(response.error.message || 'The message transaction was rejected.');
    }
    if (!isTxHash(response?.result)) throw new Error(uncertainMessage);
    pending.txHash = response.result;
    pending.submitting = false;
    save(pending);
    return pending.txHash!;
}

export function sendPendingMessage(options: SendOptions): Promise<string> {
    const existing = inFlight.get(options.key);
    if (existing) return existing;
    const result = sendPending(options).finally(() => inFlight.delete(options.key));
    inFlight.set(options.key, result);
    return result;
}
