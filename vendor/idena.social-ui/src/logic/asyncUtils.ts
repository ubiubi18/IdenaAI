import { create, toBinary } from "@bufbuild/protobuf";
import Decimal from "decimal.js";
import imageType from 'image-type';
import isSvg from 'is-svg';
import { decrypt, encrypt } from "eciesjs";
import { calculateMaxFee, decodeBlockBodyTransactions, decryptAESGCM, dna2num, dnaBase, extractPubKeyAddressFromPrivateKey, extractSenderInfoFromRawTx, getCallTransaction, getMakePostTransactionPayload, getSendMessageTransactionPayload, hex2str, hexToDecimal, isValidLowerCaseAddress, likeEmoji, sanitizeStr, str2bytes } from "./utils";
import { CallContractAttachment, ProtoStoreToIpfsAttachmentSchema, contractArgumentFormat, hexToUint8Array, toHexString, Transaction, transactionType, type ContractArgumentFormatValue, type TransactionTypeValue } from "idena-sdk-js-lite";
import ErrorLoadingMedia from '../assets/error-loading-media.png';
import type { EventTransaction } from "../App.exports";
import { keccak256, sha3_256 } from "js-sha3";
import { getSocialContractByAddress, stripKnownSocialPostIdPrefix } from "./socialContracts";
import { cacheTip } from "./tipsStore";
import { cachePoster, isPosterMissingOrStale } from "./postersStore";
import { cachePost } from "./postsStore";
import { cacheMessage } from "./messagesStore";

export const breakingChanges = {
    v3: { timestamp: 1767578641 },
    v5: { timestamp: 1767946325, block: 10219188, postIdPrefix: 'preV5:' },
    v9: { timestamp: 1775551992, block: 10604687, postIdPrefix: 'preV9:' },
    v10: { timestamp: 1775992052, block: 10627018, postIdPrefix: 'preV10:' },
    v11: { timestamp: 1777976356, block: 10727655, postIdPrefix: 'preV11:' },
    v12: { timestamp: 1781956251, block: 10929805, postIdPrefix: 'preV12:' },
};

const getContractEra = (timestamp: number, contractAddress?: string) => {
    const contract = getSocialContractByAddress(contractAddress);

    if (contract?.id === 'v11') {
        return { preV3: false, preV5: false, preV9: false, preV10: false, preV11: false, preV12: true, postIdPrefix: contract.postIdPrefix };
    }
    if (contract?.id === 'v10') {
        return { preV3: false, preV5: false, preV9: false, preV10: false, preV11: true, preV12: true, postIdPrefix: contract.postIdPrefix };
    }
    if (contract?.id === 'v9') {
        return { preV3: false, preV5: false, preV9: false, preV10: true, preV11: true, preV12: true, postIdPrefix: contract.postIdPrefix };
    }
    if (contract?.id === 'v5') {
        return { preV3: false, preV5: false, preV9: true, preV10: true, preV11: true, preV12: true, postIdPrefix: contract.postIdPrefix };
    }
    if (contract?.id === 'v1') {
        return { preV3: timestamp < breakingChanges.v3.timestamp, preV5: true, preV9: true, preV10: true, preV11: true, preV12: true, postIdPrefix: contract.postIdPrefix };
    }

    const preV3 = timestamp < breakingChanges.v3.timestamp;
    const preV5 = timestamp < breakingChanges.v5.timestamp;
    const preV9 = timestamp < breakingChanges.v9.timestamp;
    const preV10 = timestamp < breakingChanges.v10.timestamp;
    const preV11 = timestamp < breakingChanges.v11.timestamp;
    const preV12 = timestamp < breakingChanges.v12.timestamp;
    const postIdPrefix = preV5
        ? breakingChanges.v5.postIdPrefix
        : preV9
            ? breakingChanges.v9.postIdPrefix
            : preV10
                ? breakingChanges.v10.postIdPrefix
                : preV11
                    ? breakingChanges.v11.postIdPrefix
                    : preV12
                        ? breakingChanges.v12.postIdPrefix
                        : '';

    return { preV3, preV5, preV9, preV10, preV11, preV12, postIdPrefix };
};

const prefixContractPostId = (postId: string, postIdPrefix: string) =>
    postIdPrefix ? postIdPrefix + stripKnownSocialPostIdPrefix(postId) : postId;

export const supportedImageTypes = ['image/apng', 'image/avif', 'image/gif', 'image/jpeg', 'image/png', 'image/svg+xml', 'image/webp'];
export const supportedVideoTypes = ['audio/mpeg', 'audio/mp4', 'audio/ogg', 'video/mp4', 'video/webm', 'video/ogg'];
export const MAX_POST_MEDIA_BYTES_RPC = 1024 * 1024;
export const MAX_POST_MEDIA_BYTES_IDENA_APP = 1024 * 5;

const PLACEHOLDER_IPFS_URL = 'ipfs://bafybeigdyrzt5z4jj7f26dx3e6nqoeqcn2xyv4lrfjltx3dyx47n56lcfi';
const PLACEHOLDER_IPFS_CID_BYTES = new Uint8Array(34).fill(1);

export const identityStateConversion: Record<number, string> = {
    0: 'Undefined',
    1: 'Invite',
    2: 'Candidate',
    3: 'Verified',
    4: 'Suspended',
    5: 'Killed',
    6: 'Zombie',
    7: 'Newbie',
    8: 'Human',
};

export type Post = {
    timestamp: number,
    postId: string,
    poster: string,
    posterDetails_atTimeOfPost: { stake: number, state: string, age: number },
    channelId: string,
    channelPostId: string,
    message: string,
    messageResolved: boolean,
    media: string,
    mediaResolved: boolean,
    txHash: string,
    replyToPostId: string,
    postLevel: 'Post' | 'Reply' | 'Comment',
    isLike: boolean,
    image?: File,
    video?: File,
    cid?: string,
    contractAddress?: string,
    orphaned: boolean,
};
export type Message = {
    timestamp: number,
    txHash: string,
    messageId: string,
    sender: string,
    participants: string[], // includes sender
    conversationKey: string,
    channelId: string,
    message: string,
    messageResolved: boolean,
    media: string,
    mediaResolved: boolean,
    replyToMessageId: string,
    image?: File,
    video?: File,
    cid?: string,
    tags: string[],
    textPassword: string,
    mediaPassword: string,
    sendersDetails_atTimeOfMessage:  { stake: number, state: string, age: number },
    isLike: boolean,
    orphaned: boolean,
};

export type Poster = { address: string, stake: string, age: number, pubkey: string, state: string, robohash1?: File, robohash5?: File, fetchedAt?: number };
export type Tip = { postId: string, txHash: string, timestamp: number, tipper: string, tipperDetails_atTimeOfTip: { stake: number, state: string, age: number }, amount: number, burnAmount: number };
export type PostTips = { postId: string, totalAmount: number, tips: string[] };

export type NodeDetails = { idenaNodeUrl: string, idenaNodeApiKey: string };

export const getRpcClient = (nodeDetails: NodeDetails, setNodeAvailable: React.Dispatch<React.SetStateAction<boolean>>) =>
    async (method: string, params: any[], skipStateUpdate?: boolean) => {
        try {
            const response = await fetch(nodeDetails.idenaNodeUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    'method': method,
                    'params': params,
                    'id': 1,
                    'key': nodeDetails.idenaNodeApiKey
                }),
            });
            if (!response.ok) {
                throw new Error(`Response status: ${response.status}`);
            }

            !skipStateUpdate && setNodeAvailable(true);

            try {
                return await response.json();
            } catch (error) {
                console.error(error);
                return {};
            }
        } catch (error: unknown) {
            !skipStateUpdate && setNodeAvailable(false);
            console.error(error);
            return { error };
        }
    };
export type RpcClient = ReturnType<typeof getRpcClient>;


type GetMaxFeeData = {
        from: string,
        to?: string,
        type: TransactionTypeValue,
        amount: number,
        payload: any,
};
export const getMaxFee = async (rpcClient: RpcClient, data: GetMaxFeeData) => {
    try {
        const params: any = data;
        if (data.payload) params.payload = toHexString(data.payload);
        params.useProto = true;

        const { result: getMaxFeeResult } = await rpcClient('bcn_getRawTx', [params]);

        const tx = new Transaction().fromBytes(hexToUint8Array(getMaxFeeResult));

        return tx.maxFee!.toString(10);
    } catch (error) {
        console.error(error);
        return (0).toString();
    }
};

const dnaWeiToFloatString = (amount?: string) =>
    new Decimal(amount || '0').div(new Decimal(dnaBase)).toFixed(5);

const buildPostArgsValue = (
    inputPost: string,
    media: string[],
    mediaType: string[],
    replyToPostId?: string | null,
    channelId?: string | null,
) => JSON.stringify({
    message: inputPost,
    ...(replyToPostId && { replyToPostId }),
    ...(channelId && { channelId }),
    ...(media.length && { media }),
    ...(mediaType.length && { mediaType }),
});

const estimateStoreToIpfsMaxFee = async (
    rpcClient: RpcClient,
    address: string,
    size: number,
) => {
    const payload = toBinary(
        ProtoStoreToIpfsAttachmentSchema,
        create(ProtoStoreToIpfsAttachmentSchema, {
            cid: PLACEHOLDER_IPFS_CID_BYTES,
            size,
        }),
    );

    return getMaxFee(rpcClient, {
        from: address,
        type: transactionType.StoreToIpfsTx,
        amount: 0,
        payload,
    });
};

export type RpcPostCostEstimate = {
    textStoredToIpfs: boolean,
    imageStoredToIpfs: boolean,
    textStoreMaxFeeDna: string,
    imageStoreMaxFeeDna: string,
    contractCallMaxFeeDna: string,
    totalMaxFeeDna: string,
};

export const estimateRpcPostCost = async (
    rpcClient: RpcClient,
    address: string,
    contractAddress: string,
    makePostMethod: string,
    inputText: string,
    mediaFile?: File,
    replyToPostId?: string | null,
    channelId?: string | null,
): Promise<RpcPostCostEstimate> => {
    const textBytes = str2bytes(inputText);
    const textStoredToIpfs = textBytes.length > 0;
    const imageStoredToIpfs = !!mediaFile;

    const messageForContract = textStoredToIpfs ? PLACEHOLDER_IPFS_URL : inputText;
    const mediaForContract = mediaFile ? [PLACEHOLDER_IPFS_URL] : [];
    const mediaTypeForContract = mediaFile ? [mediaFile.type] : [];

    const argsValue = buildPostArgsValue(
        messageForContract,
        mediaForContract,
        mediaTypeForContract,
        replyToPostId,
        channelId,
    );

    const args = [
        {
            format: contractArgumentFormat.String,
            index: 0,
            value: argsValue,
        },
    ];

    const payload = new CallContractAttachment();
    payload.setArgs(args);
    payload.method = makePostMethod;

    const callMaxFeeResult = await getMaxFee(rpcClient, {
        from: address,
        to: contractAddress,
        type: transactionType.CallContractTx,
        amount: 0.00001,
        payload,
    });

    const { maxFeeDecimal: contractCallMaxFeeDna } = calculateMaxFee(
        callMaxFeeResult,
        messageForContract.length + JSON.stringify(mediaForContract).length,
    );

    const textStoreMaxFee = textStoredToIpfs
        ? await estimateStoreToIpfsMaxFee(rpcClient, address, textBytes.length)
        : '0';
    const imageStoreMaxFee = mediaFile
        ? await estimateStoreToIpfsMaxFee(rpcClient, address, mediaFile.size)
        : '0';

    const totalMaxFeeDna = new Decimal(contractCallMaxFeeDna)
        .add(dnaWeiToFloatString(textStoreMaxFee))
        .add(dnaWeiToFloatString(imageStoreMaxFee))
        .toFixed(5);

    return {
        textStoredToIpfs,
        imageStoredToIpfs,
        textStoreMaxFeeDna: dnaWeiToFloatString(textStoreMaxFee),
        imageStoreMaxFeeDna: dnaWeiToFloatString(imageStoreMaxFee),
        contractCallMaxFeeDna,
        totalMaxFeeDna,
    };
};

export const getPastTxsWithIdenaIndexerApi = async (indexerApiUrl: string, contractAddress: string, limit: number, continuationToken?: string) => {
    try {
        const params = new URLSearchParams({
            limit: limit.toString(),
            ...(continuationToken && { continuationToken }),
        });

        const path = `api/Contract/${contractAddress}/BalanceUpdates`;

        const response = await fetch(`${indexerApiUrl}/${path}?${params}`);

        if (!response.ok) {
            throw new Error(`Response status: ${response.status}`);
        }

        const responseBody = await response.json();

        return responseBody;
    } catch (error: unknown) {
        console.error(error);
        return { error };
    }
};

export const getLastBlockWithIdenaIndexerApi = async (indexerApiUrl: string) => {
    try {
        const path = `api/Block/Last`;

        const response = await fetch(`${indexerApiUrl}/${path}`);

        if (!response.ok) {
            throw new Error(`Response status: ${response.status}`);
        }

        const responseBody = await response.json();

        return responseBody;
    } catch (error: unknown) {
        console.error(error);
        return { error };
    }
};

export const getBlockAtWithIdenaIndexerApi = async (indexerApiUrl: string, blockHeight: number) => {
    try {
        const path = `api/Block/${blockHeight}`;

        const response = await fetch(`${indexerApiUrl}/${path}`);

        if (!response.ok) {
            throw new Error(`Response status: ${response.status}`);
        }

        const responseBody = await response.json();

        return responseBody;
    } catch (error: unknown) {
        console.error(error);
        return { error };
    }
};

export const getblockTxsWithIdenaIndexerApi = async (indexerApiUrl: string, blockHeight: number) => {
    try {
        const limit = 100;
        let continuationToken = '';

        let transactions: any[] = [];

        do {
            const params = new URLSearchParams({
                limit: limit.toString(),
                ...(continuationToken && { continuationToken }),
            });

            const path = `api/Block/${blockHeight}/Txs`;

            const response = await fetch(`${indexerApiUrl}/${path}?${params}`);

            if (!response.ok) {
                throw new Error(`Response status: ${response.status}`);
            }

            const responseBody = await response.json();

            transactions = responseBody.result ? [ ...transactions, ...responseBody.result ] : transactions;

            continuationToken = responseBody.continuationToken ?? '';

        } while (continuationToken);

        return { result: transactions };
    } catch (error: unknown) {
        console.error(error);
        return { error };
    }
};

export const getTxEventsWithIdenaIndexerApi = async (indexerApiUrl: string, txHash: string, limit: number) => {
    try {
        const params = new URLSearchParams({
            limit: limit.toString(),
        });

        const path = `api/Transaction/${txHash}/Events`;

        const response = await fetch(`${indexerApiUrl}/${path}?${params}`);

        if (!response.ok) {
            throw new Error(`Response status: ${response.status}`);
        }

        const responseBody = await response.json();

        return responseBody;
    } catch (error: unknown) {
        console.error(error);
        return { error };
    }
};

export const getAddressTxsWithIdenaIndexerApi = async (indexerApiUrl: string, address: string, limit: number, continuationToken?: string) => {
    try {
        const params = new URLSearchParams({
            limit: limit.toString(),
            ...(continuationToken && { continuationToken }),
        });

        const path = `api/Address/${address}/Txs`;

        const response = await fetch(`${indexerApiUrl}/${path}?${params}`);

        if (!response.ok) {
            throw new Error(`Response status: ${response.status}`);
        }

        const responseBody = await response.json();

        return responseBody;
    } catch (error: unknown) {
        console.error(error);
        return { error };
    }
};

export const getRawTxWithIdenaIndexerApi = async (indexerApiUrl: string, txHash: string) => {
    try {
        const path = `api/Transaction/${txHash}/Raw`;

        const response = await fetch(`${indexerApiUrl}/${path}`);

        if (!response.ok) {
            throw new Error(`Response status: ${response.status}`);
        }

        const responseBody = await response.json();

        return responseBody;
    } catch (error: unknown) {
        console.error(error);
        return { error };
    }
};

export const getTxWithIdenaIndexerApi = async (indexerApiUrl: string, txHash: string) => {
    try {
        const path = `api/Transaction/${txHash}`;

        const response = await fetch(`${indexerApiUrl}/${path}`);

        if (!response.ok) {
            throw new Error(`Response status: ${response.status}`);
        }

        const responseBody = await response.json();

        return responseBody;
    } catch (error: unknown) {
        console.error(error);
        return { error };
    }
};

export const getAddressWithIndexerApi = async (indexerApiUrl: string, posterAddress: string) => {
    try {
        const response = await fetch(`${indexerApiUrl}/api/Address/${posterAddress}`);

        if (!response.ok) {
            throw new Error(`Response status: ${response.status}`);
        }

        return await response.json();
    } catch (error: unknown) {
        console.error(error);
        return { error };
    }
};

export const getIdentityWithIndexerApi = async (indexerApiUrl: string, posterAddress: string) => {
    try {
        const response = await fetch(`${indexerApiUrl}/api/Identity/${posterAddress}`);

        if (!response.ok) {
            throw new Error(`Response status: ${response.status}`);
        }

        return await response.json();
    } catch (error: unknown) {
        console.error(error);
        return { error };
    }
};

export const getIdentityAgeWithIndexerApi = async (indexerApiUrl: string, posterAddress: string) => {
    try {
        const response = await fetch(`${indexerApiUrl}/api/Identity/${posterAddress}/Age`);

        if (!response.ok) {
            throw new Error(`Response status: ${response.status}`);
        }

        return await response.json();
    } catch (error: unknown) {
        console.error(error);
        return { error };
    }
};

export const getChildPostIds = (parentId: string, postsTreeRef: Record<string, string>) => {
    const childPostIds = [];
    let childPostId;
    let index = 0;

    do {
        childPostId = postsTreeRef[`${parentId}-${index}`];
        childPostId && (childPostIds.push(childPostId));
        index++;
    } while (childPostId);

    return childPostIds;
};

type GetTransactionDetailsRpcInput = { txHash: string, timestamp: number, blockHeight?: number, contractAddress?: string };
export const getTransactionDetailsRpc = async (
    transactions: GetTransactionDetailsRpcInput[],
    contractAddress: string,
    methods: string[],
    rpcClient: RpcClient,
) => {
    const transactionReceipts = await Promise.all(transactions.map((transaction) => rpcClient('bcn_txReceipt', [transaction.txHash])));

    const filteredReceipts = transactionReceipts.filter((receipt) =>
        (receipt.error && (() => { throw 'rpc unavailable'; })()) ||
        receipt.result &&
        receipt.result.success === true &&
        receipt.result.contract === contractAddress.toLowerCase() &&
        methods.includes(receipt.result.method)
    );

    const reducedTxs = transactions.reduce((acc, curr) => ({ ...acc, [curr.txHash]: curr }), {}) as Record<string, GetTransactionDetailsRpcInput>;
    const transactionDetails = filteredReceipts.map(receipt => ({ eventArgs: receipt.result.events?.[0]?.args, eventArgs2nd: receipt.result.events?.[1]?.args, method: receipt.result.method, contractAddress, ...reducedTxs[receipt.result.txHash] }));

    return transactionDetails;
};

type GetTransactionDetailsIndexerApiInput = { txHash: string, timestamp: number, blockHeight?: number, contractAddress?: string };
export const getTransactionDetailsIndexerApi = async (
    transactions: GetTransactionDetailsIndexerApiInput[],
    inputIdenaIndexerApiUrl: string,
) => {
    const transactionReceipts = await Promise.all(transactions.map((transaction) => getTxEventsWithIdenaIndexerApi(inputIdenaIndexerApiUrl, transaction.txHash, 10)));

    const filteredReceipts = transactionReceipts.map((tx, index) => ({ ...tx, txHash: transactions[index].txHash })).filter((receipt) =>
        (receipt.error && (() => { throw 'indexer api unavailable'; })()) ||
        receipt.result
    );

    const reducedTxs = transactions.reduce((acc, curr) => ({ ...acc, [curr.txHash]: curr }), {}) as Record<string, GetTransactionDetailsIndexerApiInput>;
    const transactionDetails = filteredReceipts.map(receipt => ({ eventArgs: receipt.result?.[0]?.data, eventArgs2nd: receipt.result?.[1]?.data, method: receipt.result?.[0]?.eventName, ...reducedTxs[receipt.txHash] }));

    return transactionDetails;
};

export const getNewPost = async (
    transaction: EventTransaction,
    thisChannelId: string,
    discussPrefix: string,
    postsRef: React.RefObject<Record<string, Post>>,
    cacheEnabled = true,
) => {
    const { txHash, eventArgs, eventArgs2nd, timestamp, contractAddress } = transaction;
    const { preV3, preV9, postIdPrefix } = getContractEra(timestamp, contractAddress);

    if (!preV9 && !eventArgs2nd?.length) {
        return { continued: true };
    }

    const poster = eventArgs[0];
    const channelId = hex2str(eventArgs[2]);
    const message = sanitizeStr(hex2str(eventArgs[3]));
    const media = hex2str(eventArgs[6]);
    const mediaType = hex2str(eventArgs[7]);

    const postChannelRegex = new RegExp(String.raw`${discussPrefix}[\d]+$`, 'i');
    const isDiscussionComment = postChannelRegex.test(channelId);

    if (channelId !== thisChannelId && !isDiscussionComment) {
        return { continued: true };
    }

    if (!message && !(media && mediaType)) {
        return { continued: true };
    }

    let postIdRaw;
    try {
        postIdRaw = hexToDecimal(eventArgs[1]);
    } catch (error) {
        return { continued: true };
    }

    const postId = prefixContractPostId(postIdRaw, postIdPrefix);
    if (postsRef.current[postId]) {
        return { continued: 'already-captured' };
    }

    let replyToPostIdRaw = '';
    try {
        replyToPostIdRaw = preV3 ? hexToDecimal(hex2str(eventArgs[4])) : hex2str(eventArgs[4]);
    } catch (error) {
        return { continued: true };
    }

    let replyToPostId = '';

    if (replyToPostIdRaw) {
        replyToPostId = replyToPostIdRaw;

        replyToPostId = prefixContractPostId(replyToPostId, postIdPrefix);
    }

    if (replyToPostId) {
        const replyToPost = postsRef.current[replyToPostId];
        const newReplyExistsAndRespectsTime = replyToPost?.timestamp ? timestamp > replyToPost.timestamp : null;

        if (newReplyExistsAndRespectsTime === false) {
            return { continued: true };
        }

        if (replyToPost?.isLike) {
            return { continued: true };
        }
    }

    let posterDetails_atTimeOfPost;
    try {
        posterDetails_atTimeOfPost = !preV9 ? {
            stake: eventArgs2nd[1] === '0x' ? 0 : Number(dna2num(parseInt(eventArgs2nd[1], 16)).toFixed(0)),
            state: identityStateConversion[Number(hexToDecimal(eventArgs2nd[2]))],
            age: Number(hexToDecimal(eventArgs2nd[3])),
        } : {
            stake: NaN,
            state: 'Unknown',
            age: NaN,
        };
    } catch (error) {
        return { continued: true };
    }

    const postLevel = isDiscussionComment ? 'Comment' : replyToPostId ? 'Reply' : 'Post';
    const channelPostId = isDiscussionComment ? getPostIdFromChannelId(timestamp, channelId, discussPrefix, contractAddress) : '';

    const isLike = message === likeEmoji && !!replyToPostId;

    const newPost = {
        timestamp,
        postId,
        poster,
        posterDetails_atTimeOfPost,
        channelId,
        channelPostId,
        txHash,
        replyToPostId,
        contractAddress,
        postLevel,
        isLike,
        message,
        messageResolved: false,
        media,
        mediaResolved: false,
        orphaned: false,
    } as Post;

    if (cacheEnabled) await cachePost(newPost);

    return { newPost };
};

export type MessagePromise = Promise<{ id: string, message: string }>;
export const getMessage = async (id: string, message: string, rpcClient: RpcClient, textPassword?: string): MessagePromise => {
    if (message.startsWith('ipfs://')) {
        const cid = message.split('ipfs://')[1];
        const { result: getCidResult } = await rpcClient('ipfs_get', [cid], true);

        if (!getCidResult) {
            message = 'Issue loading message from IPFS';
            return { id, message };
        }

        if (textPassword) {
            // @ts-ignore: Uint8Array.fromBase64 not recognized yet
            const keyData = Uint8Array.fromBase64(textPassword);
            message = sanitizeStr(hex2str(await decryptAESGCM(getCidResult, keyData)));
        } else {
            message = sanitizeStr(hex2str(getCidResult));
        }
    }

    return { id, message };
};

export type MediaPromise = Promise<{ id: string, image: File | undefined, video: File | undefined, mediaType: string, cid: string }>;
export const getMedia = async (id: string, media: string, rpcClient: RpcClient, mediaPassword?: string) => {
    let image: File | undefined;
    let video: File | undefined;
    let mediaType = '';
    let cid = '';

    if (media.startsWith('ipfs://')) {
        cid = media.split('ipfs://')[1];
        const { result: getCidResult } = await rpcClient('ipfs_get', [cid], true);

        if (!getCidResult) {
            image = await getErrorLoadingMediaFile();
            return { id, image, video, mediaType, cid };
        }

        let bytes;
        if (mediaPassword) {
            // @ts-ignore: Uint8Array.fromBase64 not recognized yet
            const keyData = Uint8Array.fromBase64(mediaPassword);
            bytes = hexToUint8Array(await decryptAESGCM(getCidResult, keyData));
        } else {
            bytes = hexToUint8Array(getCidResult);
        }
        ({ image, video, mediaType } = await getMediaFromHex(bytes));
    } else {
        // @ts-ignore: Uint8Array.fromBase64 not recognized yet
        const bytes = Uint8Array.fromBase64(media);
        ({ image, video, mediaType } = await getMediaFromHex(bytes));
    }

    return { id, image, video, mediaType, cid };
};

const getMediaFromHex = async (bytes: Uint8Array) => {
    let image: File | undefined;
    let video: File | undefined;
    let mediaType = '';

    const bytesCopy = new Uint8Array(bytes);
    mediaType = await getMediaTypeFromBuffer(bytesCopy) ?? '';

    const blob = new Blob([bytesCopy], { type: mediaType || 'application/octet-stream' });
    const file = new File([blob], '', { type: blob.type });
    const objectUrl = URL.createObjectURL(file);

    if (supportedImageTypes.includes(mediaType)) {
        const validImage = await isValidImageUrlCheck(objectUrl);
        if (validImage) {
            image = file;
        } else {
            image = await getErrorLoadingMediaFile();
            mediaType = 'image/png';
        }
    } else if (supportedVideoTypes.includes(mediaType)) {
        video = file;
    } else {
        image = await getErrorLoadingMediaFile();
        mediaType = 'image/png';
    }

    URL.revokeObjectURL(objectUrl);

    return { image, video, mediaType };
};

const getMediaTypeFromBuffer = async (bytes: Uint8Array) => {
    const imageTypeResult = await imageType(bytes);

    if (imageTypeResult) {
        return imageTypeResult.mime;
    } else {
        const svgString = new TextDecoder().decode(bytes);
        const isSvgResult = isSvg(svgString);

        if (isSvgResult) {
            return 'image/svg+xml';
        }
    }

    return;
};

const isValidImageUrlCheck = (url: string, wait = 10000): Promise<boolean> => {
    return new Promise((resolve) => {
        const img = new Image();

        const process = (validImageUrl: boolean) => {
            clearTimeout(timer);

            img.onload = null;
            img.onerror = null;

            resolve(validImageUrl);
        };

        const timer = setTimeout(() => {
            img.onload = null;
            img.onerror = null;
            // removing src aborts the in-flight image request
            img.removeAttribute('src');
            process(false);
        }, wait);

        img.onload = () => process(true);

        img.onerror = () => process(false);

        img.src = url;
    });
};

export const getErrorLoadingMediaFile = async () => {
    const response = await fetch(ErrorLoadingMedia);
    const blob = await response.blob();
    const errorLoadingMediaFile = new File([blob], 'error-loading-media.png', { type: 'image/png' });

    return errorLoadingMediaFile;
};

export const processTip = async (
    transaction: EventTransaction,
    tipsRef: React.RefObject<Record<string, Tip>>,
    cacheEnabled = true,
) => {
    const { txHash, eventArgs, eventArgs2nd, timestamp, contractAddress } = transaction;

    if (tipsRef.current[txHash]) {
        return { continued: 'already-captured' };
    }

    const { preV9, preV11, postIdPrefix } = getContractEra(timestamp, contractAddress);

    const tipper = eventArgs[0];

    const postIdEventArg = preV9 ? eventArgs[1] : eventArgs[2];

    let postIdRaw;
    try {
        postIdRaw = hexToDecimal(postIdEventArg);
    } catch (error) {
        return { continued: true };
    }

    const postId = prefixContractPostId(postIdRaw, postIdPrefix);
    const amountEventArg = preV9 ? eventArgs[2] : eventArgs[3];
    const amount = parseInt(amountEventArg, 16);

    const sentAmountEventArg = preV11 ? eventArgs[3] : eventArgs[4];
    const sentAmount = parseInt(sentAmountEventArg, 16);

    const burnAmount = sentAmount - amount;

    let tipperDetails_atTimeOfTip;
    try {
        tipperDetails_atTimeOfTip = !preV9 ? {
            stake: eventArgs2nd[1] === '0x' ? 0 : Number(dna2num(parseInt(eventArgs2nd[1], 16)).toFixed(0)),
            state: identityStateConversion[Number(hexToDecimal(eventArgs2nd[2]))],
            age: Number(hexToDecimal(eventArgs2nd[3])),
        } : {
            stake: NaN,
            state: 'Unknown',
            age: NaN,
        };
    } catch (error) {
        return { continued: true };
    }

    const newTip = {
        postId,
        txHash,
        timestamp,
        tipper,
        tipperDetails_atTimeOfTip,
        amount,
        burnAmount,
    };

    if (cacheEnabled) await cacheTip(newTip);

    return { newTip };
};

const postersPromised: Record<string, boolean> = {};
export const getPosterPromise = (
    address: string,
    postersRef: React.RefObject<Record<string, Poster>>,
    useIndexer: boolean,
    rpcClient?: RpcClient,
    indexerApiUrlRef?: React.RefObject<string>,
    cacheEnabled = true,
) => {
    const poster = postersRef.current[address];
    if (isPosterMissingOrStale(poster) && !postersPromised[address]) {
        postersPromised[address] = true;
        const posterPromise = (useIndexer ? getPosterWithIndexerApi(indexerApiUrlRef!.current, address) : getPosterWithRpc(rpcClient!, address)) as Promise<Poster>;
        return posterPromise
            .then((newPoster) => {
                postersRef.current = { ...postersRef.current, [address]: newPoster };
                if (cacheEnabled) cachePoster(newPoster);
                return newPoster;
            })
            .finally(() => postersPromised[address] = false);
    }
    return poster;
};

export const getPosterWithRpc = async (rpcClient: RpcClient, posterAddress: string, skipStateUpdate?: boolean): Promise<Poster | undefined> => {
    const { result: getDnaIdentityResult, error: getDnaIdentityError } = await rpcClient('dna_identity', [posterAddress], skipStateUpdate);

    if (!skipStateUpdate && getDnaIdentityError) {
        throw 'rpc unavailable';
    }

    if (!getDnaIdentityResult) {
        return;
    }

    const { address, stake, age, pubkey, state } = getDnaIdentityResult;

    const [ robohash1, robohash5 ] = await Promise.all([getRobohash(address, '1'), getRobohash(address, '5')]);

    return { address, stake, age, pubkey, state, robohash1, robohash5, fetchedAt: Date.now() };
};

export const getPoster = getPosterWithRpc;

export const getPosterWithIndexerApi = async (indexerApiUrl: string, posterAddress: string): Promise<Poster | undefined> => {
    const [addressResult, identityResult, ageResult] = await Promise.all([
        getAddressWithIndexerApi(indexerApiUrl, posterAddress),
        getIdentityWithIndexerApi(indexerApiUrl, posterAddress),
        getIdentityAgeWithIndexerApi(indexerApiUrl, posterAddress),
    ]);

    if (addressResult.error) {
        return;
    }

    const { address, stake } = addressResult.result;
    const { state } = identityResult.error ? { state: 'Not validated' } : identityResult.result;
    const age = ageResult.error ? 0 : ageResult.result;
    const pubkey = await getPubKeyWithIdenaIndexerApi(indexerApiUrl, posterAddress) ?? '';

    const [ robohash1, robohash5 ] = await Promise.all([getRobohash(address, '1'), getRobohash(address, '5')]);

    return { address, stake, age, pubkey, state, robohash1, robohash5, fetchedAt: Date.now() };
};

export const getRobohash = async (address: string, setNumber: string) => {
    try {
        const profilePicResponse = await fetch(`https://robohash.org/${address}?set=set${setNumber}`);

        if (!profilePicResponse.ok) {
            return undefined;
        }

        const blob = await profilePicResponse.blob();

        return new File([blob], `robohash${setNumber}-${address}`, { type: blob.type });
    } catch {
        return undefined;
    }
};

export const processMessage = async (
    message: EventTransaction,
    encryptedPrivateKey: string,
    password: string,
    postersAddress: string,
    messagesRef: React.RefObject<Record<string, Message>>,
    thisChannelId: string,
    postersRef: React.RefObject<Record<string, Poster>>,
    rpcClientRef: React.RefObject<RpcClient | undefined>,
    postersPromised: string[],
    findPostsWithRef: React.RefObject<string>,
    indexerApiUrlRef: React.RefObject<string>,
    desktopDecryptMessage?: (payload: {
        txHash: string;
        messageHash: string;
        senderCiphertext: string;
        recipientCiphertext: string;
        ciphertexts: string[];
    }) => Promise<{
        plaintext: string;
        role: 'sender' | 'recipient' | 'both';
        ciphertextIndexes?: number[];
    }>,
    cacheEnabled = true,
) => {
    const { txHash, eventArgs, eventArgs2nd, timestamp } = message;

    if (!eventArgs2nd?.length) {
        return { continued: true };
    }

    const sender = eventArgs[0];

    let newMessageId;
    try {
        newMessageId = hexToDecimal(eventArgs[1]);
    } catch (error) {
        return { continued: true };
    }

    const messageEventRaw = hex2str(eventArgs[2]);

    if (!messageEventRaw) {
        return { continued: true };
    }

    const messageEventHash = hex2str(eventArgs[3]);
    if (!messageEventHash) {
        return { continued: true };
    }

    const encrypted = hex2str(eventArgs[4]);
    if (encrypted !== 'true') {
        return { continued: true };
    }

    const messageEvent = messageEventRaw.split(',');

    if (
        messageEvent.length < 2 ||
        messageEvent.length > 16 ||
        messageEvent.some(ciphertext => !ciphertext)
    ) {
        return { continued: true };
    }

    const iAmSender = sender === postersAddress.toLowerCase();
    let messageDecoded: string | undefined;
    let decryptSuccesses: number[] = [];

    if (desktopDecryptMessage) {
        try {
            const result = await desktopDecryptMessage({
                txHash,
                messageHash: messageEventHash,
                senderCiphertext: messageEvent[0],
                recipientCiphertext: messageEvent[1],
                ciphertexts: messageEvent,
            });

            messageDecoded = result.plaintext;

            if (
                Array.isArray(result.ciphertextIndexes) &&
                result.ciphertextIndexes.length > 0 &&
                result.ciphertextIndexes.every(index =>
                    Number.isInteger(index) && index >= 0 && index < messageEvent.length
                ) &&
                new Set(result.ciphertextIndexes).size === result.ciphertextIndexes.length
            ) {
                decryptSuccesses = [...result.ciphertextIndexes].sort((a, b) => a - b);
            } else if (messageEvent.length === 2) {
                decryptSuccesses = result.role === 'both'
                    ? [0, 1]
                    : [result.role === 'sender' ? 0 : 1];
            } else {
                return { continued: true };
            }
        } catch {
            return { continued: true };
        }
    } else {
        const keyData = new Uint8Array(sha3_256.array(password));
        const myPrivateKey = await decryptAESGCM(encryptedPrivateKey, keyData);
        const myPrivateKeyBytes = hexToUint8Array(myPrivateKey);

        for (let index = 0; index < messageEvent.length; index++) {
            try {
                // @ts-ignore: Uint8Array.fromBase64 not recognized yet
                const encryptedMessage = Uint8Array.fromBase64(messageEvent[index]);
                const decryptedMessage = await decrypt(myPrivateKeyBytes, encryptedMessage);
                const decodedMessage = new TextDecoder().decode(decryptedMessage);

                if (keccak256(decodedMessage) !== messageEventHash) {
                    return { continued: true };
                }

                decryptSuccesses.push(index);
                if (decryptSuccesses.length > 1 && messageEvent.length > 2) {
                    return { continued: true };
                }
                messageDecoded = decodedMessage;
            } catch {
                if (index === 0 && iAmSender) {
                    return { continued: true };
                }
            }
        }
    }

    if (!decryptSuccesses.length || !messageDecoded) {
        return { continued: true };
    }

    let decodedPayload: unknown;
    try {
        decodedPayload = JSON.parse(messageDecoded);
    } catch {
        return { continued: true };
    }

    if (!Array.isArray(decodedPayload)) {
        return { continued: true };
    }

    const [ participantsRaw, channelId, inputText, textPassword, replyToMessageId, mediaArray, mediaTypeArray, mediaPassword, tags ] = decodedPayload;

    if (
        !Array.isArray(participantsRaw) ||
        !participantsRaw.every((item) => typeof item === 'string') ||
        typeof channelId !== 'string' ||
        typeof inputText !== 'string' ||
        typeof textPassword !== 'string' ||
        typeof replyToMessageId !== 'string' ||
        !Array.isArray(mediaArray) ||
        !Array.isArray(mediaTypeArray) ||
        typeof mediaPassword !== 'string' ||
        !Array.isArray(tags)
    ) {
        return { continued: true };
    }

    const media = mediaArray[0] ?? '';
    const mediaType = mediaTypeArray[0] ?? '';

    const sanitizedInputText = sanitizeStr(inputText);

    if (!sanitizedInputText && !(media && mediaType)) {
        return { continued: true };
    }

    if (messagesRef.current[newMessageId]) {
        return { continued: 'already-captured' };
    }

    if (channelId !== thisChannelId) {
        return { continued: true };
    }

    if (
        replyToMessageId &&
        (!/^\d+$/.test(replyToMessageId) || parseInt(replyToMessageId) >= parseInt(newMessageId))
    ) {
        return { continued: true };
    }

    if (replyToMessageId && messagesRef.current[replyToMessageId]?.isLike) {
        return { continued: true };
    }

    if (participantsRaw.length !== messageEvent.length) {
        return { continued: true };
    }

    if (participantsRaw[0] !== sender) {
        return { continued: true };
    }

    if (participantsRaw.length > 2 && new Set(participantsRaw).size !== participantsRaw.length) {
        return { continued: true };
    }

    for (let index = 0; index < participantsRaw.length; index++) {
        const participant = participantsRaw[index];

        if (!isValidLowerCaseAddress(participant)) {
            return { continued: true };
        }
    }

    const selfParticipants = participantsRaw.filter((participant: string) => participant === postersAddress.toLowerCase());
    if (selfParticipants.length !== decryptSuccesses.length) {
        return { continued: true };
    }

    for (let index = 0; index < decryptSuccesses.length; index++) {
        const jindex = decryptSuccesses[index];

        if (participantsRaw[jindex] !== postersAddress.toLowerCase()) {
            return { continued: true };
        }
    }

    const participants = participantsRaw.map((item: string) => item.toLowerCase()).sort();
    const conversationKey = keccak256(participants.join('-'));

    let sendersDetails_atTimeOfMessage;
    try {
        sendersDetails_atTimeOfMessage = {
            stake: eventArgs2nd[1] === '0x' ? 0 : Number(dna2num(parseInt(eventArgs2nd[1], 16)).toFixed(0)),
            state: identityStateConversion[Number(hexToDecimal(eventArgs2nd[2]))],
            age: Number(hexToDecimal(eventArgs2nd[3])),
        };
    } catch (error) {
        return { continued: true };
    }

    const isLike = sanitizedInputText === likeEmoji && !!replyToMessageId;

    const newMessage = {
        timestamp,
        txHash,
        messageId: newMessageId,
        message: sanitizedInputText,
        messageResolved: false,
        media,
        mediaResolved: false,
        sender,
        participants,
        conversationKey,
        channelId,
        replyToMessageId,
        tags,
        textPassword,
        mediaPassword,
        sendersDetails_atTimeOfMessage,
        isLike,
        orphaned: false,
    } as Message;

    if (cacheEnabled && !desktopDecryptMessage) {
        await cacheMessage(newMessage, postersAddress, encryptedPrivateKey, password);
    }

    const messagePromise = newMessage.message.startsWith('ipfs://')
        ? getMessage(newMessage.messageId, newMessage.message, rpcClientRef.current!, newMessage.textPassword)
        : Promise.resolve({ id: newMessage.messageId, message: newMessage.message });
    void postersRef;
    void postersPromised;
    void findPostsWithRef;
    void indexerApiUrlRef;
    return { newMessage, messagePromise };
};

export const saveReplyPostId = (
    newReplyPostId: string,
    replyToPostId: string,
    replyToPost: Post | Message,
    isRecurseForward: boolean,
    replyPostsTreeRef: Record<string, string>,
    forwardOrphanedReplyPostsTreeRef: Record<string, string>,
    backwardOrphanedReplyPostsTreeRef: Record<string, string>,
    newReplyPosts: Record<string, string>,
    newForwardOrphanedReplyPosts: Record<string, string>,
    newBackwardOrphanedReplyPosts: Record<string, string>,
) => {
    if (replyToPostId) {
        if (!replyToPost || replyToPost.orphaned) {
            if (isRecurseForward) {
                const childPostIds = getChildPostIds(replyToPostId, forwardOrphanedReplyPostsTreeRef);
                newForwardOrphanedReplyPosts[`${replyToPostId}-${childPostIds.length}`] = newReplyPostId;
            } else {
                const childPostIds = getChildPostIds(replyToPostId, backwardOrphanedReplyPostsTreeRef);
                newBackwardOrphanedReplyPosts[`${replyToPostId}-${childPostIds.length}`] = newReplyPostId;
            }
        } else {
            const childPostIds = getChildPostIds(replyToPostId, replyPostsTreeRef);
            newReplyPosts[`${replyToPostId}-${childPostIds.length}`] = newReplyPostId;
        }
    }
};

export const deOrphanReplyPosts = (
    parentId: string,
    parentPost: Post | Message,
    forwardOrphanedReplyPostsTreeRef: Record<string, string>,
    backwardOrphanedReplyPostsTreeRef: Record<string, string>,
    postsRef: Record<string, Post> | Record<string, Message>,
    newForwardOrphanedReplyPosts: Record<string, string>,
    newBackwardOrphanedReplyPosts: Record<string, string>,
    newDeOrphanedReplyPosts: Record<string, string>,
    newPosts: Record<string, Post> | Record<string, Message>,
) => {
    const newForwardDeOrphanedIds = getChildPostIds(parentId, forwardOrphanedReplyPostsTreeRef).map((deOrphanedId, index) => ({ recurseForward: true, oldKey: `${parentId}-${index}`, deOrphanedId }));
    const newBackwardDeOrphanedIds = getChildPostIds(parentId, backwardOrphanedReplyPostsTreeRef).map((deOrphanedId, index) => ({ recurseForward: false, oldKey: `${parentId}-${index}`, deOrphanedId }));

    const childDetailsOrdered = [ ...newForwardDeOrphanedIds.reverse(), ...newBackwardDeOrphanedIds ];

    for (let index = 0; index < childDetailsOrdered.length; index++) {
        const newKey = `${parentId}-${index}`;
        const childDetails = childDetailsOrdered[index];

        if (childDetails.recurseForward) {
            newForwardOrphanedReplyPosts[childDetails.oldKey] = '';
        } else {
            newBackwardOrphanedReplyPosts[childDetails.oldKey] = '';
        }

        if (parentPost.isLike) {
            newPosts[childDetails.deOrphanedId] = undefined as unknown as (Post | Message);
            continue;
        }

        newDeOrphanedReplyPosts[newKey] = childDetails.deOrphanedId;
        newPosts[childDetails.deOrphanedId] = { ...postsRef[childDetails.deOrphanedId], orphaned: false };
    }
};

export const getBlockHeightFromTxHash = async (txHash: string, rpcClient: RpcClient) => {
    const { result: getTransactionResult, error: getTransactionError } = await rpcClient('bcn_transaction', [txHash]);

    if (getTransactionError) {
        throw 'rpc unavailable';
    }

    const { result: getBlockByHashResult, error: getBlockByHashError } = await rpcClient('bcn_block', [getTransactionResult.blockHash]);

    if (getBlockByHashError) {
        throw 'rpc unavailable';
    }

    return getBlockByHashResult.height;
};

export const copyPostTx = async (
    postersAddress: string,
    contractAddress: string,
    makePostMethod: string,
    inputPost: string,
    media: string[],
    mediaType: string[],
    replyToPostId: string | null,
    channelId: string | null,
    rpcClient: RpcClient,
) => {
    const { txAmount, payload } = getMakePostTransactionPayload(makePostMethod, inputPost, replyToPostId, channelId, media, mediaType);
    const inputPostLength = inputPost.length + JSON.stringify(media).length;
    const maxFeeResult = await getMaxFee(rpcClient, { from: postersAddress, to: contractAddress, type: transactionType.CallContractTx, amount: txAmount.toNumber(), payload });
    const { maxFeeDna } = calculateMaxFee(maxFeeResult, inputPostLength);
    const { nonce, epoch } = await getNonceAndEpoch(rpcClient, postersAddress);
    const txHex = getCallTransaction(contractAddress, txAmount, nonce, epoch, maxFeeDna, payload);

    try {
        await navigator.clipboard.writeText(txHex);
        return { success: true };
    } catch (err) {
        console.error('Failed to copy: ', err);
        return { success: false };
    }
};

export const submitPost = async (
    postersAddress: string,
    contractAddress: string,
    makePostMethod: string,
    inputPost: string,
    media: string[],
    mediaType: string[],
    replyToPostId: string | null,
    channelId: string | null,
    makePostsWith: string,
    rpcClient: RpcClient,
    callbackUrl: string,
) => {
    const { txAmount, args, payload } = getMakePostTransactionPayload(makePostMethod, inputPost, replyToPostId, channelId, media, mediaType);
    const inputPostLength = inputPost.length + JSON.stringify(media).length;

    await makeCallTransaction(
        postersAddress,
        contractAddress,
        makePostMethod,
        makePostsWith,
        rpcClient,
        callbackUrl,
        txAmount,
        args,
        payload,
        inputPostLength,
    );
};

export const submitSendTip = async (
    postersAddress: string,
    contractAddress: string,
    sendTipMethod: string,
    postId: string,
    amount: string,
    makePostsWith: string,
    rpcClient: RpcClient,
    callbackUrl: string,
) => {
    const txAmount = new Decimal(amount);
    const args = [
        {
            format: contractArgumentFormat.String,
            index: 0,
            value: JSON.stringify({ postId, tipAmount: amount }),
        }
    ];
    const payload = new CallContractAttachment();
    payload.setArgs(args);
    payload.method = sendTipMethod;

    await makeCallTransaction(
        postersAddress,
        contractAddress,
        sendTipMethod,
        makePostsWith,
        rpcClient,
        callbackUrl,
        txAmount,
        args,
        payload,
    );
};

export const copyMessageTx = async (
    postersAddress: string,
    contractAddress: string,
    sendMessageMethod: string,
    inputMessage: string[],
    inputMessageHash: string,
    rpcClient: RpcClient,
) => {
    const { txAmount, payload } = getSendMessageTransactionPayload(sendMessageMethod, inputMessage, inputMessageHash);
    const inputMessageLength = JSON.stringify(inputMessage).length + inputMessageHash.length;
    const maxFeeResult = await getMaxFee(rpcClient, { from: postersAddress, to: contractAddress, type: transactionType.CallContractTx, amount: txAmount.toNumber(), payload });
    const { maxFeeDna } = calculateMaxFee(maxFeeResult, inputMessageLength);
    const { nonce, epoch } = await getNonceAndEpoch(rpcClient, postersAddress);
    const txHex = getCallTransaction(contractAddress, txAmount, nonce, epoch, maxFeeDna, payload);

    try {
        await navigator.clipboard.writeText(txHex);
        return { success: true };
    } catch (err) {
        console.error('Failed to copy: ', err);
        return { success: false };
    }
};

export const prepareRpcMessageCall = async (
    postersAddress: string,
    contractAddress: string,
    sendMessageMethod: string,
    inputMessage: string[],
    inputMessageHash: string,
    rpcClient: RpcClient,
) => {
    const {txAmount, args} = getSendMessageTransactionPayload(sendMessageMethod, inputMessage, inputMessageHash);
    const call = {
        from: postersAddress, contract: contractAddress, method: sendMessageMethod,
        amount: txAmount.toNumber(), args, maxFee: '10',
    };
    const response = await rpcClient('contract_estimateCall', [call], true);
    if (response?.error || response?.result?.success !== true) {
        throw new Error(response?.error?.message || response?.result?.error || 'The node could not validate the message transaction.');
    }
    const {gasCost, txFee} = response.result;
    if (gasCost == null || txFee == null) throw new Error('The node did not return a message fee estimate.');
    const cost = new Decimal(gasCost);
    const fee = new Decimal(txFee);
    if (!cost.isFinite() || cost.isNegative() || !fee.isFinite() || fee.isNegative()) {
        throw new Error('The node returned an invalid message fee estimate.');
    }
    const maxFee = cost.add(fee).mul('1.2');
    const feeLimit = 20;
    if (maxFee.greaterThan(feeLimit)) throw new Error(`The message exceeds the desktop fee limit of ${feeLimit} IDNA.`);
    return {...call, maxFee: maxFee.toFixed()};
};

export const submitMessage = async (
    postersAddress: string,
    contractAddress: string,
    sendMessageMethod: string,
    inputMessage: string[],
    inputMessageHash: string,
    makePostsWith: string,
    rpcClient: RpcClient,
    callbackUrl: string,
) => {
    if (makePostsWith === 'rpc') {
        const call = await prepareRpcMessageCall(postersAddress, contractAddress, sendMessageMethod, inputMessage, inputMessageHash, rpcClient);
        const response = await rpcClient('contract_call', [call]);
        if (response?.error || typeof response?.result !== 'string' || !/^0x[0-9a-f]{64}$/i.test(response.result)) {
            throw new Error(response?.error?.message || 'The node did not accept the message transaction.');
        }
        return response.result as string;
    }
    const { txAmount, args, payload } = getSendMessageTransactionPayload(sendMessageMethod, inputMessage, inputMessageHash);
    const inputMessageLength = JSON.stringify(inputMessage).length + inputMessageHash.length;

    await makeCallTransaction(
        postersAddress,
        contractAddress,
        sendMessageMethod,
        makePostsWith,
        rpcClient,
        callbackUrl,
        txAmount,
        args,
        payload,
        inputMessageLength,
    );

};

type CallContractArg = {
    format: ContractArgumentFormatValue;
    index: number;
    value: string;
};
export const makeCallTransaction = async (
    from: string,
    to: string,
    method: string,
    makePostsWith: string,
    rpcClient: RpcClient,
    callbackUrl: string,
    txAmount: Decimal,
    args: CallContractArg[],
    payload: CallContractAttachment,
    inputPostLength = 0,
) => {
    const maxFeeResult = await getMaxFee(rpcClient, {
        from,
        to,
        type: transactionType.CallContractTx,
        amount: txAmount.toNumber(),
        payload,
    });

    const { maxFeeDecimal, maxFeeDna } = calculateMaxFee(maxFeeResult, inputPostLength);

    if (makePostsWith === 'rpc') {
        return await rpcClient('contract_call', [
            {
                from,
                contract: to,
                method,
                amount: txAmount.toNumber(),
                args,
                maxFee: maxFeeDecimal,
            }
        ]);
    }

    if (makePostsWith === 'idena-app') {
        const { nonce, epoch } = await getNonceAndEpoch(rpcClient, from);

        const txHex = getCallTransaction(to, txAmount, nonce, epoch, maxFeeDna, payload);

        const dnaLink = `https://app.idena.io/dna/raw?tx=${txHex}&callback_format=html&callback_url=${callbackUrl}?method=${method}`;
        window.open(dnaLink, '_blank');
    }
};

export const getNonceAndEpoch = async (rpcClient: RpcClient, address: string) => {
    const responses = await Promise.all([rpcClient('dna_getBalance', [address]), rpcClient('dna_epoch', [])]);

    const { result: getBalanceResult } = responses[0];
    const { result: epochResult } = responses[1];

    return { nonce: getBalanceResult.mempoolNonce + 1, epoch: epochResult.epoch as number };
};

export const storeFileToIpfs = async (rpcClient: RpcClient, bytes: Uint8Array, address: string) => {
    const fileHexData = toHexString(bytes);

    const { result: cid } = await rpcClient('ipfs_add', [fileHexData, true], true);

    if (!cid) {
        return;
    };

    const { nonce, epoch } = await getNonceAndEpoch(rpcClient, address);
    const { result: storeToIpfsResult } = await rpcClient('dna_storeToIpfs', [{ cid, nonce, epoch }]);

    if (!storeToIpfsResult) return;

    return `ipfs://${cid}`;
};

export const getPostIdFromChannelId = (timestamp: number, channelId: string, discussPrefix: string, contractAddress?: string) => {
    const { postIdPrefix } = getContractEra(timestamp, contractAddress);
    const discussionPostIdRaw = channelId.split(discussPrefix)[1];
    return prefixContractPostId(discussionPostIdRaw, postIdPrefix);
};

export const getNewPostLatestActivity = (
    isRecurseForward: boolean,
    newPost: Post,
    postsRef: React.RefObject<Record<string, Post>>,
    postLatestActivityRef: React.RefObject<Record<string, number>>,
) => {
    const newPostLatestActivity: Record<string, number> = {};

    if (isRecurseForward) {
        let loopPost: Post | undefined = newPost;

        while (loopPost) {
            newPostLatestActivity[loopPost!.postId] = newPost!.timestamp;

            const replyToPostId: string = loopPost!.replyToPostId;
            const postLevel = loopPost!.postLevel;

            if (replyToPostId) {
                loopPost = postsRef.current[replyToPostId];
            } else if (postLevel === 'Comment') {
                const discussionPostId = loopPost!.channelPostId as string;
                loopPost = postsRef.current[discussionPostId];
            } else {
                loopPost = undefined;
            }
        }
    } else {
        let newTimestamp = postLatestActivityRef.current[newPost!.postId] ?? newPost!.timestamp;
        postLatestActivityRef.current[newPost!.postId] = newTimestamp;

        const replyToPostId = newPost!.replyToPostId;
        const postLevel = newPost!.postLevel;

        if (replyToPostId) {
            newTimestamp = (postLatestActivityRef.current[replyToPostId] ?? 0) > newTimestamp ? postLatestActivityRef.current[replyToPostId] : newTimestamp;
            newPostLatestActivity[replyToPostId] = newTimestamp;
        } else if (postLevel === 'Comment') {
            const discussionPostId = newPost!.channelPostId;
            newTimestamp = (postLatestActivityRef.current[discussionPostId] ?? 0) > newTimestamp ? postLatestActivityRef.current[discussionPostId] : newTimestamp;
            newPostLatestActivity[discussionPostId] = newTimestamp;
        }
    }

    return newPostLatestActivity;
};

export const resolveNewTextForPosts = async (
    textPromises: MessagePromise[],
    postsRef: React.RefObject<Record<string, Post>>,
    cacheEnabled = true,
) => {
    const texts = await Promise.all(textPromises);
    for (let index = 0; index < texts.length; index++) {
        const { id, ...messagesPropsWithoutId } = texts[index];
        const updatedPost = { ...postsRef!.current[id], ...messagesPropsWithoutId, messageResolved: true };
        if (cacheEnabled) await cachePost(updatedPost as Post);
        postsRef!.current = { ...postsRef!.current, [id]: updatedPost };
    }
};

export const resolveNewTextForMessages = async (
    textPromises: MessagePromise[],
    postersAddress: string,
    encryptedPrivateKey: string,
    password: string,
    messagesRef: React.RefObject<Record<string, Message>>,
    cacheEnabled = true,
) => {
    const texts = await Promise.all(textPromises);
    for (let index = 0; index < texts.length; index++) {
        const { id, ...messagesPropsWithoutId } = texts[index];
        const updatedMessage = { ...messagesRef!.current[id], ...messagesPropsWithoutId, messageResolved: true };
        if (cacheEnabled) await cacheMessage(updatedMessage, postersAddress, encryptedPrivateKey, password);
        messagesRef!.current = { ...messagesRef!.current, [id]: updatedMessage };
    }
};

export const resolveNewMediaForPosts = async (
    mediaPromises: MediaPromise[],
    postsRef: React.RefObject<Record<string, Post>>,
    cacheEnabled = true,
) => {
    const media = await Promise.all(mediaPromises);
    for (let index = 0; index < media.length; index++) {
        const { id, ...messagesPropsWithoutId } = media[index];
        const updatedPost = { ...postsRef!.current[id], ...messagesPropsWithoutId, mediaResolved: true };
        if (cacheEnabled) await cachePost(updatedPost as Post);
        postsRef!.current = { ...postsRef!.current, [id]: updatedPost };
    }
};

export const resolveNewMediaForMessages = async (
    mediaPromises: MediaPromise[],
    postersAddress: string,
    encryptedPrivateKey: string,
    password: string,
    messagesRef: React.RefObject<Record<string, Message>>,
    cacheEnabled = true,
) => {
    const media = await Promise.all(mediaPromises);
    for (let index = 0; index < media.length; index++) {
        const { id, ...messagesPropsWithoutId } = media[index];
        const updatedMessage = { ...messagesRef!.current[id], ...messagesPropsWithoutId, mediaResolved: true };
        if (cacheEnabled) await cacheMessage(updatedMessage, postersAddress, encryptedPrivateKey, password);
        messagesRef!.current = { ...messagesRef!.current, [id]: updatedMessage };
    }
};

export const getPubKeyWithIdenaIndexerApi = async (indexerApiUrl: string, address: string) => {
    let pubKey = '';
    const limit = 100;
    let continuationToken = '';
    let txHash;

    outerLoop: do {
        const { result: getAddressTxsResult, error: getAddressTxsError, continuationToken: continuationTokenCurrent } = await getAddressTxsWithIdenaIndexerApi(indexerApiUrl, address, limit, continuationToken);

        if (!getAddressTxsError && getAddressTxsResult?.length) {
            for (let index = 0; index < getAddressTxsResult.length; index++) {
                const tx = getAddressTxsResult[index];
                if (tx.from.toLowerCase() === address.toLowerCase()) {
                    txHash = tx.hash;
                    break outerLoop;
                }
            }
        } else {
            break;
        }

        continuationToken = continuationTokenCurrent ?? '';

    } while (continuationToken);

    if (txHash) {
        const { result: getRawTxResult, error: getRawTxError } = await getRawTxWithIdenaIndexerApi(indexerApiUrl, txHash);

        if (!getRawTxError && getRawTxResult) {
            try {
                pubKey = extractSenderInfoFromRawTx(getRawTxResult).pubKey ?? '';
            } catch (error) {
                // do nothing
            }
        }
    }

    return pubKey;
};

export const getPubKeyWithRpc = async (rpcClient: RpcClient, address: string) => {
    let pubKey = '';
    const count = 100;
    let token;
    let txHash;
    let blockHash;

    outerLoop: do {
        const { result: getTransactionsResult, error: getTransactionsError } = await rpcClient('bcn_transactions', [{ address, count, ...(token && { token }) }], true);

        if (!getTransactionsError && getTransactionsResult.transactions?.length) {
            for (let index = 0; index < getTransactionsResult.transactions.length; index++) {
                const tx = getTransactionsResult.transactions[index];
                if (tx.from.toLowerCase() === address.toLowerCase()) {
                    txHash = tx.hash;
                    blockHash = tx.blockHash;
                    break outerLoop;
                }
            }
        } else {
            break;
        }

        token = getTransactionsResult.token;

    } while (token);

    let ipfsCid;
    let txIndex;
    let blockBodyData;

    if (txHash && blockHash) {
        const { result: getBlockResult, error: getBlockError } = await rpcClient('bcn_block', [blockHash], true);

        if (!getBlockError && getBlockResult) {
            ipfsCid = getBlockResult.ipfsCid;
            txIndex = getBlockResult.transactions.findIndex((item: string) => item === txHash);
        }

        if (ipfsCid && txIndex > -1) {
            ({ result: blockBodyData } = await rpcClient('ipfs_get', [ipfsCid], true));
        }

        if (blockBodyData) {
            const transaction = decodeBlockBodyTransactions(blockBodyData)[txIndex];
            const senderInfo = transaction ? extractSenderInfoFromRawTx(transaction.toHex()) : undefined;
            pubKey = senderInfo?.pubKey ?? '';
        }
    }

    return pubKey;
};

// Keep the v12.4 public API spelling while preserving compatibility with the
// existing IdenaAI callers that use the historical PubKey form.
export const getPubkeyWithIdenaIndexerApi = getPubKeyWithIdenaIndexerApi;
export const getPubkeyWithRpc = getPubKeyWithRpc;
export const encryptRecipientsMessage = async (
    postersAddress: string,
    recipients: string[],
    inputText: string,
    textPassword: string,
    media: string[],
    mediaType: string[],
    mediaPassword: string,
    encryptedPrivateKey: string,
    password: string,
    postersRef: React.RefObject<Record<string, Poster>>,
    replyToMessageId?: string,
) => {
    // [participants, channelId, message, textPassword (AES-GCM encryption), replyToMessageId, media, mediaType, mediaPassword (AES-GCM encryption), tags]
    const rawMessage = JSON.stringify([[postersAddress.toLowerCase(), ...recipients], '', inputText, textPassword, replyToMessageId ?? '', media, mediaType, mediaPassword, []]);
    const rawMessageHash = keccak256(rawMessage);

    const { encryptedMessage, encodedMessage } = await encryptTextWithPrivateKey(rawMessage, encryptedPrivateKey, password);

    const message = [encryptedMessage];

    for (let index = 0; index < recipients.length; index++) {
        const recipient = recipients[index];
        const recipientDetails = postersRef.current[recipient];

        const recipientEncryptedMessage = await encrypt(hexToUint8Array(recipientDetails.pubkey), encodedMessage);
        // @ts-ignore: Uint8Array.toBase64 not recognized yet
        const recipientSerializedEncryptedMessage = recipientEncryptedMessage.toBase64();

        message.push(recipientSerializedEncryptedMessage);
    }

    return { message, rawMessageHash };
};

export const encryptTextWithPrivateKey = async (text: string, encryptedPrivateKey: string, password: string) => {
    const encodedMessage = new TextEncoder().encode(text);
    const keyData = new Uint8Array(sha3_256.array(password));
    const myPrivateKey = await decryptAESGCM(encryptedPrivateKey, keyData);
    const { pubKey: myPubkey } = extractPubKeyAddressFromPrivateKey(myPrivateKey);
    const myEncryptedMessage = await encrypt(hexToUint8Array(myPubkey), encodedMessage);
    // @ts-ignore: Uint8Array.toBase64 not recognized yet
    return { encryptedMessage: myEncryptedMessage.toBase64(), encodedMessage };
};

export const decryptTextWithPrivateKey = async (text: string, encryptedPrivateKey: string, password: string) => {
    const keyData = new Uint8Array(sha3_256.array(password));
    const myPrivateKey = await decryptAESGCM(encryptedPrivateKey, keyData);
    const myPrivateKeyBytes = hexToUint8Array(myPrivateKey);
    // @ts-ignore: Uint8Array.fromBase64 not recognized yet
    const encryptedMessage = Uint8Array.fromBase64(text);
    const myMessageDecrypted = await decrypt(myPrivateKeyBytes, encryptedMessage);
    return (new TextDecoder()).decode(myMessageDecrypted);
};
