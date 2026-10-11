import { describe, expect, it } from 'vitest';
import { getDirectDeliverySendError, isDirectDeliveryAuthor, isDirectDeliveryBuyer, parseDirectDelivery } from './directDelivery';

const author = 'a'.repeat(40);
const buyer = 'b'.repeat(40);
const text = `{"format":"fod.direct-delivery","version":2,"network":"idena","contract":"${'c'.repeat(40)}","author":"${author}","offerId":"${'d'.repeat(64)}","orderId":18446744073709551615,"orderNonce":1,"buyer":"${buyer}","deliveryKey":"${'e'.repeat(130)}","ciphertext":"${'f'.repeat(438)}"}`;

describe('FoD direct delivery handoff', () => {
    it('keeps the canonical JSON bytes and compares account addresses case-insensitively', () => {
        const delivery = parseDirectDelivery(text);

        expect(delivery?.text).toBe(text);
        expect(new TextEncoder().encode(delivery!.text)).toEqual(new TextEncoder().encode(text));
        expect(isDirectDeliveryAuthor(delivery!, `0x${author.toUpperCase()}`)).toBe(true);
        expect(isDirectDeliveryBuyer(delivery!, `0x${buyer.toUpperCase()}`)).toBe(true);
        expect(isDirectDeliveryAuthor(delivery!, `0x${buyer}`)).toBe(false);
        expect(isDirectDeliveryBuyer(delivery!, `0x${author}`)).toBe(false);
        expect(isDirectDeliveryAuthor(delivery!, author)).toBe(false);
    });

    it('rejects noncanonical, malformed, duplicate, and oversized input', () => {
        const invalid = [
            ` ${text}`,
            `${text}\n`,
            text.replace('"version":2', '"version":1'),
            text.replace('"network":"idena"', '"network":"testnet"'),
            text.replace('"author":', `"author":"${author}","author":`),
            text.replace('"contract":', `"author":"${author}","contract":`),
            text.replace('"orderId":18446744073709551615', '"orderId":18446744073709551616'),
            text.replace('"orderNonce":1', '"orderNonce":0'),
            text.replace('"orderNonce":1', '"orderNonce":01'),
            text.replace('"ciphertext":"', '"ciphertext":"0x'),
            text.replace('"buyer":"', '"buyer":"B'),
            text + ' '.repeat(2049),
        ];

        for (const candidate of invalid) {
            expect(parseDirectDelivery(candidate)).toBeNull();
        }
    });

    it('checks the final sender, active identity, sole buyer, and media before sending', () => {
        const sender = `0x${author}`;
        const recipient = `0x${buyer}`;

        expect(getDirectDeliverySendError(text, sender, `0x${author.toUpperCase()}`, [recipient], false)).toBeNull();
        expect(getDirectDeliverySendError(text, sender, recipient, [recipient], false)).toMatch(/active identity/);
        expect(getDirectDeliverySendError(text, recipient, sender, [recipient], false)).toMatch(/active identity/);
        expect(getDirectDeliverySendError(text, sender, sender, [sender], false)).toMatch(/buyer/);
        expect(getDirectDeliverySendError(text, sender, sender, [recipient, sender], false)).toMatch(/buyer/);
        expect(getDirectDeliverySendError(text, sender, sender, [recipient], true)).toMatch(/media/);
        expect(getDirectDeliverySendError(text.replace('"orderNonce":1', '"orderNonce":0'), sender, sender, [recipient], false)).toMatch(/Invalid/);
        expect(getDirectDeliverySendError('ordinary message', sender, recipient, [sender], true)).toBeNull();
    });
});
