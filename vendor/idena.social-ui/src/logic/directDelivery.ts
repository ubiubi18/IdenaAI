export type DirectDelivery = {
    text: string,
    contract: string,
    orderId: string,
    author: string,
    buyer: string,
};

const UINT64_MAX = 18446744073709551615n;
export const DIRECT_V4_CONTRACT = '3730be2217b0de1fdfe73098d37f3174dd9748cb';

// Match the exact compact, ordered v2 JSON emitted by Flips on Demand.
const deliveryPattern = new RegExp([
    '^\\{"format":"fod\\.direct-delivery","version":2,"network":"idena",',
    '"contract":"(?<contract>[0-9a-f]{40})","author":"(?<author>[0-9a-f]{40})",',
    '"offerId":"[0-9a-f]{64}","orderId":(?<orderId>[1-9][0-9]*),',
    '"orderNonce":(?<orderNonce>[1-9][0-9]*),"buyer":"(?<buyer>[0-9a-f]{40})",',
    '"deliveryKey":"04[0-9a-f]{128}","ciphertext":"[0-9a-f]{438}"\\}$',
].join(''));

export function parseDirectDelivery(text: string): DirectDelivery | null {
    if (text.length > 2048) return null;

    const groups = deliveryPattern.exec(text)?.groups;
    if (!groups?.contract || !groups.author || !groups.buyer || !groups.orderId || !groups.orderNonce) return null;
    if (BigInt(groups.orderId) > UINT64_MAX || BigInt(groups.orderNonce) > UINT64_MAX) return null;

    return { text, contract: groups.contract, orderId: groups.orderId, author: groups.author, buyer: groups.buyer };
}

function matchesAddress(address: string, bareAddress: string): boolean {
    return /^0x[0-9a-fA-F]{40}$/.test(address) && address.slice(2).toLowerCase() === bareAddress;
}

export function isDirectDeliveryAuthor(delivery: DirectDelivery, address: string): boolean {
    return matchesAddress(address, delivery.author);
}

export function isDirectDeliveryBuyer(delivery: DirectDelivery, address: string): boolean {
    return matchesAddress(address, delivery.buyer);
}

function identifiesDirectDelivery(text: string): boolean {
    if (/^\s*\{\s*"format"\s*:\s*"fod\.direct-delivery"/.test(text)) return true;
    if (!text.trimStart().startsWith('{') || !text.includes('"fod.direct-delivery"')) return false;

    try {
        const value = JSON.parse(text);
        return value !== null && typeof value === 'object' && !Array.isArray(value) && value.format === 'fod.direct-delivery';
    } catch {
        return false;
    }
}

export function getDirectDeliverySendError(
    text: string,
    senderAddress: string,
    activeAddress: string,
    recipients: string[],
    hasMedia: boolean,
): string | null {
    if (!identifiesDirectDelivery(text)) return null;

    const delivery = parseDirectDelivery(text);
    if (!delivery) return 'Invalid flip delivery text.';
    if (!isDirectDeliveryAuthor(delivery, senderAddress) || !isDirectDeliveryAuthor(delivery, activeAddress)) {
        return 'Flip delivery author does not match the active identity.';
    }
    if (recipients.length !== 1 || !isDirectDeliveryBuyer(delivery, recipients[0])) {
        return 'Flip delivery requires only its buyer as recipient.';
    }
    if (hasMedia) return 'Flip delivery cannot include media.';
    return null;
}
