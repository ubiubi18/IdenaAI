import {
    Address,
    BASE_IDNA,
    Bytes,
    Context,
    Host, 
    Balance,
    PersistentMap,
    util,
    u128,
    models,
} from 'idena-sdk-as';
import { Protobuf } from 'as-proto';

const createGetIdentityPromiseGasLimit = 20_000;
const defaultGetIdentityGasLimit = 2_000_000;

class IdentityDetails {
    epoch: u16;
    state: u32;
    age: u32;
    stake: Uint8Array;

    constructor(epoch: u16 = 0, state: u32 = 0, age: u32 = 0, stake: Uint8Array = new Uint8Array(0)) {
        this.epoch = epoch;
        this.state = state;
        this.age = age;
        this.stake = stake;
    }
}

class MakePostArgs {
    message: string = '';
    channelId: string = '';
    replyToPostId: string = '';
    repostPostId: string = '';
    media: string[] = [];
    mediaType: string[] = [];
    tags: string[] = [];
    _getIdentityGasLimit: u32 = defaultGetIdentityGasLimit;
}

class SendTipArgs {
    postId: string = '0';
    tipAmount: string = '0';
    _getIdentityGasLimit: u32 = defaultGetIdentityGasLimit;
}

class SendMessageArgs {
    recipient: string = '';
    message: string = '';
    encrypted: boolean = false;
    channelId: string = '';
    replyToMessageTxId: string = '';
    _getIdentityGasLimit: u32 = defaultGetIdentityGasLimit;
}

export class IdenaSocial {
    currentPostId: u128;
    posts: PersistentMap<u128, string>;
    identities: PersistentMap<Address, IdentityDetails>;

    constructor() {
        this.currentPostId = u128.Zero;
        this.posts = PersistentMap.withStringPrefix<u128, string>('p:');
        this.identities = PersistentMap.withStringPrefix<Address, IdentityDetails>('i:');
    }

    @mutateState
    makePost(args: MakePostArgs): void {
        const caller = Context.caller();
        const callerBytes = caller.toBytes();

        const postId = u128.add(this.currentPostId, u128.fromString('1'));
        this.posts.set(postId, util.toHexString(caller, true));

        this.currentPostId = postId;

        Host.emitEvent('makePost', [
            callerBytes,
            Bytes.fromu128(postId),
            Bytes.fromString(args.channelId),
            Bytes.fromString(args.message),
            Bytes.fromString(args.replyToPostId),
            Bytes.fromString(args.repostPostId),
            Bytes.fromString(args.media.toString()),
            Bytes.fromString(args.mediaType.toString()),
            Bytes.fromString(args.tags.toString()),
            Bytes.fromBytes(Context.payAmount().toBytes())
        ]);

        const currentEpoch = Context.epoch();
        const posterDetails: IdentityDetails = this.identities.get(caller, new IdentityDetails());

        if (posterDetails.epoch === currentEpoch) {
            Host.emitEvent('_identity', [callerBytes, Bytes.fromBytes(posterDetails.stake), Bytes.fromU32(posterDetails.state), Bytes.fromU32(posterDetails.age)]);
        } else {
            Host.createGetIdentityPromise(caller, createGetIdentityPromiseGasLimit).then('_getIdentity', [callerBytes], Balance.Zero, args._getIdentityGasLimit);
        }
    }

    @mutateState
    sendTip(args: SendTipArgs): void {
        const postId = u128.fromString(args.postId);
        util.assert(postId > u128.Zero && postId <= this.currentPostId, 'non-existent post');

        const tipAmount: Balance = new Balance(u128.mul(u128.fromString(args.tipAmount), BASE_IDNA.value));
        util.assert(tipAmount > Balance.Zero, 'cannot tip nothing');

        const payAmount = Context.payAmount();

        util.assert(tipAmount <= payAmount, 'cannot tip more than sent');

        const posterHex: string = this.posts.get(postId, '');
        const poster = Address.fromBytes(util.decodeFromHex(posterHex));

        const caller = Context.caller();
        const callerBytes = caller.toBytes();

        Host.createTransferPromise(poster, tipAmount);
        Host.emitEvent('sendTip', [callerBytes, poster.toBytes(), Bytes.fromu128(postId), Bytes.fromBytes(tipAmount.toBytes()), Bytes.fromBytes(payAmount.toBytes())]);

        const currentEpoch = Context.epoch();
        const posterDetails: IdentityDetails = this.identities.get(caller, new IdentityDetails());

        if (posterDetails.epoch === currentEpoch) {
            Host.emitEvent('_identity', [callerBytes, Bytes.fromBytes(posterDetails.stake), Bytes.fromU32(posterDetails.state), Bytes.fromU32(posterDetails.age)]);
        } else {
            Host.createGetIdentityPromise(caller, createGetIdentityPromiseGasLimit).then('_getIdentity', [callerBytes], Balance.Zero, args._getIdentityGasLimit);
        }
    }

    @mutateState
    sendMessage(args: SendMessageArgs): void {
        const caller = Context.caller();
        const callerBytes = caller.toBytes();

        Host.emitEvent('sendMessage', [
            callerBytes,
            Bytes.fromString(args.recipient),
            Bytes.fromString(args.channelId),
            Bytes.fromString(args.message),
            Bytes.fromString(args.encrypted.toString()),
            Bytes.fromString(args.replyToMessageTxId),
            Bytes.fromBytes(Context.payAmount().toBytes())
        ]);
        
        const currentEpoch = Context.epoch();
        const posterDetails: IdentityDetails = this.identities.get(caller, new IdentityDetails());

        if (posterDetails.epoch === currentEpoch) {
            Host.emitEvent('_identity', [callerBytes, Bytes.fromBytes(posterDetails.stake), Bytes.fromU32(posterDetails.state), Bytes.fromU32(posterDetails.age)]);
        } else {
            Host.createGetIdentityPromise(caller, createGetIdentityPromiseGasLimit).then('_getIdentity', [callerBytes], Balance.Zero, args._getIdentityGasLimit);
        }
    }

    @mutateState
    _getIdentity(originalCaller: Address): void {
        const res = Host.promiseResult();
        util.assert(!res.failed(), 'createGetIdentityPromise result should be successful');

        const identity = Protobuf.decode<models.ProtoStateIdentity>(res.data, models.ProtoStateIdentity.decode);
        const epoch = Context.epoch();
        const age = identity.birthday === 0 ? 0 : epoch - identity.birthday;

        this.identities.set(originalCaller, new IdentityDetails(epoch, identity.state, age, identity.stake));

        Host.emitEvent('identity', [originalCaller.toBytes(), Bytes.fromBytes(identity.stake), Bytes.fromU32(identity.state), Bytes.fromU32(age)]);
    }
}
