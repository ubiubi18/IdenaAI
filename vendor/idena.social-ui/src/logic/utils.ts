import Decimal from "decimal.js";
import * as secp256k1 from "@noble/secp256k1";
import { keccak_256 } from "js-sha3";
import { CallContractAttachment, contractArgumentFormat, hexToUint8Array, privateKeyToPublicKey, publicKeyToAddress, toHexString, Transaction, transactionType } from "idena-sdk-js-lite";
import type { PostMediaAttachment } from "../App.exports";
import { getPostIdFromChannelId, type Post } from "./asyncUtils";

export const likeEmoji = '❤️';
export const dnaBase = 1e18;

export function getDisplayAddress(address: string) {
    return `${address.slice(0, 7)}...${address.slice(-5)}`;
}

export function getDisplayAddressShort(address: string) {
    return `${address.slice(0, 5)}...${address.slice(-3)}`;
}

export function getDisplayAddressVeryShort(address: string) {
    return `${address.slice(0, 4)}...${address.slice(-2)}`;
}

export function getDisplayDateTime(timestamp: number) {
    const datePost = new Date(timestamp * 1000);
    const dateToday = new Date();
    const dateYesterday = new Date(dateToday.getTime() - 24 * 60 * 60 * 1000);
    const postLocaleDateString = datePost.toLocaleDateString('en-GB');
    const displayDate = postLocaleDateString === dateToday.toLocaleDateString('en-GB') ? 'Today' : postLocaleDateString === dateYesterday.toLocaleDateString('en-GB') ? 'Yesterday' : postLocaleDateString;
    const postLocaleTimeString = datePost.toLocaleTimeString(['en-US'], { hour: '2-digit', minute: '2-digit'});
    const displayTime = postLocaleTimeString.replace(/^0+/, '');

    return { displayDate, displayTime };
}

export function getMessageLines(message?: string, calculateViewMoreIndex = false, maxLines = 10) {
    const limit = 30;

    if (!message) {
        return { messageLines: [''] };
    }

    let messageLines = message.split(/\r\n/g, limit);
    if (messageLines.length === 1) {
        messageLines = message.split(/\n/g, limit);
    }

    if (!calculateViewMoreIndex) {
        return { messageLines };
    }

    const charsPerLine = 65;
    let accLines = 0;
    let index = 0;
    let textOverflows = false;
    let truncatedMessageLines: string[] = [];

    for (; index < messageLines.length; index++) {
        const messageLineItem = messageLines[index];
        const isLastIteration = index === messageLines.length - 1;
        const messagelineLength = messageLineItem.length;
        const addedLinesFloat = messagelineLength / charsPerLine;
        const addedLines = isLastIteration ? addedLinesFloat : Math.ceil(addedLinesFloat);

        accLines += addedLines;

        if (accLines >= maxLines) {
            const overflowChars = Math.floor((accLines - maxLines) * charsPerLine);
            truncatedMessageLines = messageLines.slice(0, index);

            const lastLineLength = messageLineItem.length - overflowChars;
            let lastLine = overflowChars === 0 ? messageLineItem : messageLineItem.slice(0, lastLineLength);
            
            if (overflowChars !== 0 && messageLineItem.charAt(lastLineLength - 1) !== ' ' && messageLineItem.charAt(lastLineLength) !== ' ') {
                lastLine += '...';
            }

            truncatedMessageLines.push(lastLine);
            textOverflows = true;
            break;
        }
    }

    return { messageLines, textOverflows, truncatedMessageLines };
}

export function calculateMaxFee(maxFeeResult: string, inputPostLength: number) {
    const perCharMaxFeeDivisor = 200;
    const maxFeeResultMultiplier = 2;
    const totalMaxFeeMultiplier = 10;

    const maxFeeDecimal = new Decimal(maxFeeResult).mul(maxFeeResultMultiplier).div(new Decimal(dnaBase));
    const additionalPerCharFee = maxFeeDecimal.div(perCharMaxFeeDivisor).mul(inputPostLength);
    const maxFeeCalculated = maxFeeDecimal.add(additionalPerCharFee).mul(totalMaxFeeMultiplier);
    const maxFeeCalculatedDna = maxFeeCalculated.mul(new Decimal(dnaBase));

    return { maxFeeDecimal: maxFeeCalculated.toString(), maxFeeDna: maxFeeCalculatedDna.toString() };
}

export function dna2num(dna: string | number) {
    return Number((new Decimal(dna).div(new Decimal(dnaBase))).toString());
}

export function numStr2dnaStr(num: string) {
    return (new Decimal(num).mul(new Decimal(dnaBase))).toString();
}

export function hex2str(hex: string) {
    return new TextDecoder().decode(hexToUint8Array(hex));
}

export function str2bytes(str: string) {
    return new TextEncoder().encode(str);
}

export function sanitizeStr(str: string) {
    return new DOMParser().parseFromString(str, 'text/html').body.textContent || '';
}

export function numToUint8Array(num: number, uint8ArrayLength: number) {
    const arr = new Uint8Array(uint8ArrayLength);

    for (let i = 0; i < 8; i++) {
        arr[i] = num % 256;
        num = Math.floor(num / 256);
    }

    return arr;
}

function bytesToDecimalNum(bytes: Uint8Array) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const num = view.getUint32(0, true);

    return num;
}

export function hexToDecimal(hex: string) {
    if (!hex) return hex;

    const bytes = hexToUint8Array(hex);
    const decimalVal = bytesToDecimalNum(bytes);

    return decimalVal.toString();
}

export function decimalToHex(dec: string, uint8ArrayLength: number) {
    return toHexString(numToUint8Array(Number(dec), uint8ArrayLength));
}

export function isObjectEmpty(obj: object) {
    // @ts-ignore
    for (const i in obj) return false;
    return true;
}

export function getDisplayTipAmount(amount: number) {
    const num = dna2num(amount);
    return (Number(num.toFixed(2)) || '0.00').toString();
}

export function getShortDisplayTipAmount(amount: number) {
    const num = dna2num(amount);

    let display;

    if (num < 1) {
        display = '<1';
    }
    if (num >= 1) {
        display = num.toFixed(0);
    }
    if (num >= 1000) {
        display = '1K+';
    }
    if (num >= 10000) {
        display = '10K+';
    }
    if (num >= 100000) {
        display = '100K+';
    }
    if (num >= 1000000) {
        display = '1M+';
    }

    return display;
}

export function getIdentityStatus(state: string) {
    return state === 'Undefined' ? 'Not validated' : state;
}

export function getBase64FromDataUrl(dataUrl: string) {
    const dataUrlSplit = dataUrl.split(',');
    const base64Media = dataUrlSplit[1];
    const base64MediaType = dataUrlSplit[0].split(';')[0].split(':')[1];

    return { base64Media, base64MediaType };
}

export function getTextAndMediaForPost(postTextareaElement: HTMLTextAreaElement, postMediaAttachment?: PostMediaAttachment) {
    const inputText = postTextareaElement.value ?? '';

    const { base64Media, base64MediaType } = postMediaAttachment ? getBase64FromDataUrl(postMediaAttachment.dataUrl) : {};

    const media = base64Media ? [base64Media] : [];
    const mediaType = base64MediaType ? [base64MediaType] : [];

    return { inputText, media, mediaType };
}

export function getMakePostTransactionPayload(makePostMethod: string, inputPost: string, replyToPostId: string | null, channelId: string | null, media: string[], mediaType: string[]) {
    const txAmount = new Decimal(0.00001);
    const args = [
        {
            format: contractArgumentFormat.String,
            index: 0,
            value: JSON.stringify({
                message: inputPost,
                ...(replyToPostId && { replyToPostId }),
                ...(channelId && { channelId }),
                ...(media.length && { media }),
                ...(mediaType.length && { mediaType }),
            }),
        }
    ];

    const payload = new CallContractAttachment();
    payload.setArgs(args);
    payload.method = makePostMethod;

    return { txAmount, args, payload };
}

export function getSendMessageTransactionPayload(sendMessageMethod: string, inputMessage: string[], inputMessageHash: string) {
    const txAmount = new Decimal(0.00001);
    const args = [
        {
            format: contractArgumentFormat.String,
            index: 0,
            value: JSON.stringify({
                message: inputMessage,
                messageHash: inputMessageHash,
                encrypted: true,
            }),
        }
    ];

    const payload = new CallContractAttachment();
    payload.setArgs(args);
    payload.method = sendMessageMethod;

    return { txAmount, args, payload };
}

export function getCallTransaction(to: string, txAmount: Decimal, nonce: number, epoch: number, maxFeeDna: string, payload: CallContractAttachment) {
    const tx = new Transaction();
    tx.type = transactionType.CallContractTx;
    tx.to = hexToUint8Array(to);
    tx.amount = txAmount.mul(dnaBase).toString();
    tx.nonce = nonce;
    tx.epoch = epoch;
    tx.maxFee = maxFeeDna;
    tx.payload = payload.toBytes();

    return tx.toHex();
}

export function getTimestampFromIndexerApi(indexerApiTimestamp: number) {
    if (!indexerApiTimestamp) return undefined;

    return Math.floor((new Date(indexerApiTimestamp)).getTime() / 1000 );
}

export function extractPubKeyAddressFromPrivateKey(privateKey: string) {
    const pubKey = privateKeyToPublicKey(privateKey);
    const address = publicKeyToAddress(pubKey);

    return { pubKey, address };
}

export async function encryptAESGCM(data: Uint8Array<ArrayBuffer>, rawSecretKey: Uint8Array<ArrayBuffer>) {
    const secretKey = await crypto.subtle.importKey('raw', rawSecretKey, 'AES-GCM', false, ['encrypt']);
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await window.crypto.subtle.encrypt({ name: 'AES-GCM', iv }, secretKey, data);
    const combined = new Uint8Array(iv.length + ciphertext.byteLength);
    combined.set(iv);
    combined.set(new Uint8Array(ciphertext), iv.length);
    return combined;
}

export async function decryptAESGCM(data: string, keyData: Uint8Array<ArrayBuffer>) {
    const bytes = hexToUint8Array(data);
    const iv = bytes.slice(0, 12);
    const ciphertext = bytes.slice(12);
    const key = await window.crypto.subtle.importKey('raw', keyData, 'AES-GCM', false, ['decrypt']);
    const decryptedBuffer = await window.crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
    return toHexString(new Uint8Array(decryptedBuffer));
}

export function isValidAddress(address: string) {
    return /^0x[0-9a-fA-F]{40}$/.test(address);
};

export function isValidLowerCaseAddress(address: string) {
    return /^0x[0-9a-f]{40}$/.test(address);
};

type ProtoField = {
    fieldNumber: number;
    wireType: number;
    bytes?: Uint8Array;
};

const readProtoVarint = (bytes: Uint8Array, offset: number) => {
    let value = 0;
    let multiplier = 1;

    for (let index = 0; index < 10; index++) {
        if (offset >= bytes.length) throw new Error('Truncated protobuf varint');

        const byte = bytes[offset++];
        value += (byte & 0x7f) * multiplier;

        if (!Number.isSafeInteger(value)) throw new Error('Protobuf varint exceeds the safe integer range');
        if ((byte & 0x80) === 0) return { value, offset };

        multiplier *= 128;
    }

    throw new Error('Protobuf varint is too long');
};

const readProtoFields = (bytes: Uint8Array): ProtoField[] => {
    const fields: ProtoField[] = [];
    let offset = 0;

    while (offset < bytes.length) {
        const keyResult = readProtoVarint(bytes, offset);
        const fieldNumber = Math.floor(keyResult.value / 8);
        const wireType = keyResult.value % 8;
        offset = keyResult.offset;

        if (fieldNumber === 0) throw new Error('Invalid protobuf field number');

        if (wireType === 0) {
            offset = readProtoVarint(bytes, offset).offset;
        } else if (wireType === 1) {
            offset += 8;
        } else if (wireType === 2) {
            const lengthResult = readProtoVarint(bytes, offset);
            offset = lengthResult.offset;
            const end = offset + lengthResult.value;

            if (!Number.isSafeInteger(end) || end > bytes.length) throw new Error('Truncated protobuf field');

            fields.push({ fieldNumber, wireType, bytes: bytes.slice(offset, end) });
            offset = end;
            continue;
        } else if (wireType === 5) {
            offset += 4;
        } else {
            throw new Error(`Unsupported protobuf wire type: ${wireType}`);
        }

        if (offset > bytes.length) throw new Error('Truncated protobuf field');
        fields.push({ fieldNumber, wireType });
    }

    return fields;
};

export function decodeBlockBodyTransactions(blockBodyHex: string) {
    const fields = readProtoFields(hexToUint8Array(blockBodyHex));

    return fields
        .filter((field) => field.fieldNumber === 1 && field.wireType === 2 && field.bytes)
        .map((field) => Transaction.fromBytes(field.bytes!));
}

export function extractSenderInfoFromRawTx(rawTx: string): { address?: string; pubkey?: string; pubKey?: string; error?: unknown } {
    try {
        const fields = readProtoFields(hexToUint8Array(rawTx));
        const dataFields = fields.filter((field) => field.fieldNumber === 1 && field.wireType === 2 && field.bytes);
        const signatureFields = fields.filter((field) => field.fieldNumber === 2 && field.wireType === 2 && field.bytes);

        if (dataFields.length !== 1 || signatureFields.length !== 1) {
            throw new Error('Transaction must contain exactly one data field and one signature field');
        }

        const data = dataFields[0].bytes!;
        const signature = signatureFields[0].bytes!;

        if (signature.length !== 65 || signature[64] > 3) throw new Error('Invalid recoverable transaction signature');

        const recovered = secp256k1.recoverPublicKey(
            new Uint8Array([signature[64], ...signature.slice(0, 64)]),
            new Uint8Array(keccak_256.array(data)),
            { prehash: false },
        );
        const publicKey = secp256k1.Point.fromBytes(recovered).toBytes(false);

        const pubkey = toHexString(publicKey, false);
        return { address: publicKeyToAddress(publicKey), pubkey, pubKey: pubkey };
    } catch (error) {
        return { error };
    }
}

export function getSpotlightPostDetails(targetPost: Post, postsRef: React.RefObject<Record<string, Post>>, discussPrefix: string) {
    let replyPostId;
    let discussionPostId;
    let postItemKey;
    let parentPostId;
    let parentPost;

    switch (targetPost?.postLevel) {
    case 'Post': {
        parentPostId = targetPost.postId;
        parentPost = targetPost;
        postItemKey = targetPost.postId;
        break;
    }
    case 'Reply': {
        replyPostId = targetPost.postId;
        const replyPost = postsRef.current[replyPostId];
        parentPostId = replyPost?.replyToPostId;
        parentPost = postsRef.current[parentPostId];
        postItemKey = `${parentPostId}-${replyPostId}`;
        break;
    }
    case 'Comment': {
        discussionPostId = targetPost.postId;
        const discussionPost = postsRef.current[discussionPostId];
        replyPostId = getPostIdFromChannelId(
            discussionPost.timestamp,
            discussionPost.channelId,
            discussPrefix,
            discussionPost.contractAddress,
        );
        const replyPost = postsRef.current[replyPostId];
        parentPostId = replyPost?.replyToPostId;
        parentPost = postsRef.current[parentPostId];
        postItemKey = `${parentPostId}-${replyPostId}-${discussionPostId}`;
        break;
    }
    default: {
        // this shouldn't happen.
        break;
    }
    }

    return { replyPostId, discussionPostId, postItemKey, parentPost };
}
