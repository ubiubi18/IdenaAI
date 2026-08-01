import {describe, expect, it} from 'vitest';
import {Transaction, privateKeyToAddress, privateKeyToPublicKey, toHexString} from 'idena-sdk-js-lite';
import {decodeBlockBodyTransactions, extractSenderInfoFromRawTx, getMessageLines} from './utils';

const encodeVarint = (input: number) => {
    const bytes: number[] = [];
    let value = input;

    do {
        const next = value % 128;
        value = Math.floor(value / 128);
        bytes.push(value ? next | 0x80 : next);
    } while (value);

    return bytes;
};

describe('getMessageLines', () => {
    it('limits LF-only and CRLF messages to the same bounded line count', () => {
        const lines = Array.from({length: 35}, (_, index) => `line-${index}`);

        expect(getMessageLines(lines.join('\n')).messageLines).toEqual(
            lines.slice(0, 30),
        );
        expect(getMessageLines(lines.join('\r\n')).messageLines).toEqual(
            lines.slice(0, 30),
        );
    });

    it('returns one empty line for missing content', () => {
        expect(getMessageLines()).toEqual({messageLines: ['']});
    });
});

describe('pinned SDK compatibility helpers', () => {
    const privateKey = `0x${'01'.padStart(64, '0')}`;
    const transaction = new Transaction({nonce: 7, epoch: 12}).sign(privateKey);

    it('recovers the sender address and uncompressed public key', () => {
        const sender = extractSenderInfoFromRawTx(transaction.toHex());

        expect(sender.error).toBeUndefined();
        expect(sender.address).toBe(privateKeyToAddress(privateKey));
        expect(sender.pubKey).toBe(privateKeyToPublicKey(privateKey));
    });

    it('decodes repeated transactions from an Idena block body', () => {
        const transactionBytes = transaction.toBytes();
        const blockBody = new Uint8Array([
            0x0a,
            ...encodeVarint(transactionBytes.length),
            ...transactionBytes,
            0x0a,
            ...encodeVarint(transactionBytes.length),
            ...transactionBytes,
        ]);

        const decoded = decodeBlockBodyTransactions(toHexString(blockBody));

        expect(decoded).toHaveLength(2);
        expect(decoded.map((item) => item.toHex())).toEqual([transaction.toHex(), transaction.toHex()]);
    });

    it('fails closed for malformed transaction and block protobuf data', () => {
        expect(extractSenderInfoFromRawTx('0x0a02ff').error).toBeInstanceOf(Error);
        expect(() => decodeBlockBodyTransactions('0x0a02ff')).toThrow('Truncated protobuf field');
    });
});
