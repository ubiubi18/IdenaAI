import {keccak256} from 'js-sha3';
import {afterAll, beforeAll, describe, expect, it, vi} from 'vitest';
import {processMessage, type Poster} from './asyncUtils';

const sender = '0x0000000000000000000000000000000000000001';
const recipient = '0x0000000000000000000000000000000000000002';

const toHex = (value: string) =>
    `0x${Array.from(new TextEncoder().encode(value), byte => byte.toString(16).padStart(2, '0')).join('')}`;

const poster = (address: string): Poster => ({
    address,
    age: 1,
    pubkey: '',
    stake: '0',
    state: 'Human',
});

describe('desktop direct-message processing', () => {
    beforeAll(() => {
        vi.stubGlobal(
            'DOMParser',
            class {
                parseFromString(value: string) {
                    return {body: {textContent: value}};
                }
            },
        );
    });

    afterAll(() => {
        vi.unstubAllGlobals();
    });

    it('uses the host bridge without exposing manual key credentials', async () => {
        const plaintext = JSON.stringify([
            [sender, recipient],
            '',
            'hello from the verified host bridge',
            '',
            '',
            [],
            [],
            '',
            [],
        ]);
        const messageHash = keccak256(plaintext);
        const senderCiphertext = 'c2VuZGVyIGNpcGhlcnRleHQ=';
        const recipientCiphertext = 'cmVjaXBpZW50IGNpcGhlcnRleHQ=';
        const decryptWithHost = vi.fn().mockResolvedValue({
            plaintext,
            role: 'recipient',
        });
        const rpcClient = vi.fn();
        const messagesRef = {current: {}};
        const postersRef = {
            current: {
                [sender]: poster(sender),
                [recipient]: poster(recipient),
            },
        };

        const result = await processMessage(
            {
                txHash: `0x${'11'.repeat(32)}`,
                eventArgs: [
                    sender,
                    '0x01000000',
                    toHex(`${senderCiphertext},${recipientCiphertext}`),
                    toHex(messageHash),
                    toHex('true'),
                ],
                eventArgs2nd: [sender, '0x', '0x01000000', '0x01000000'],
                method: 'sendMessage',
                timestamp: 1,
            },
            '',
            '',
            recipient,
            messagesRef,
            '',
            postersRef,
            {current: rpcClient},
            [],
            decryptWithHost,
        );

        expect(decryptWithHost).toHaveBeenCalledWith({
            txHash: `0x${'11'.repeat(32)}`,
            messageHash,
            senderCiphertext,
            recipientCiphertext,
        });
        expect(result.continued).toBeUndefined();
        expect(result.newMessage).toMatchObject({
            sender,
            participants: [sender, recipient],
            txHash: `0x${'11'.repeat(32)}`,
        });
        await expect(result.messagePromise).resolves.toEqual({
            id: '1',
            message: 'hello from the verified host bridge',
        });
        expect(rpcClient).not.toHaveBeenCalled();
    });

    it('drops a message when host verification rejects it', async () => {
        const decryptWithHost = vi.fn().mockRejectedValue(new Error('unverified'));

        const result = await processMessage(
            {
                txHash: `0x${'22'.repeat(32)}`,
                eventArgs: [
                    sender,
                    '0x01000000',
                    toHex(
                        'YQ==,Yg==',
                    ),
                    toHex(keccak256('untrusted')),
                    toHex('true'),
                ],
                eventArgs2nd: [sender, '0x', '0x01000000', '0x01000000'],
                method: 'sendMessage',
                timestamp: 1,
            },
            '',
            '',
            recipient,
            {current: {}},
            '',
            {current: {[sender]: poster(sender), [recipient]: poster(recipient)}},
            {current: vi.fn()},
            [],
            decryptWithHost,
        );

        expect(result).toEqual({continued: true});
    });
});
