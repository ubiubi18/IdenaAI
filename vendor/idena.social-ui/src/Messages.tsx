import { useEffect, useReducer, useRef, useState } from "react";
import { useOutletContext } from "react-router";
import { type Message, type Poster } from "./logic/asyncUtils";
import { type BrowserStateHistorySettings, type Conversation, type MouseEventLocal, type PostMediaAttachment } from "./App.exports";
import ConversationComponent from "./components/ConversationComponent";
import ObjectUrlImageComponent from "./components/ObjectUrlImageComponent";
import { isValidAddress } from "./logic/utils";
import { resolveMessagingRecipient } from "./logic/messageRecipients";
import { isDirectDeliveryAuthor, parseDirectDelivery } from "./logic/directDelivery";
import PageHeaderComponent from "./components/PageHeaderComponent";
import ComposerToolbarComponent from "./components/ComposerToolbarComponent";
import { CloseIcon, UserPlusIcon } from "./components/icons";

type MessagesProps = {
    copyMessageTxHandler: (location: string, recipients: string[], replyToMessageId?: string | undefined) => Promise<void>,
    submitMessageHandler: (location: string, recipients: string[], replyToMessageId?: string) => Promise<void>
    submitMessageLikeHandler: (emoji: string, location: string, recipients: string[], replyToMessageId: string) => Promise<void>,
    nodeAvailable: boolean,
    makePostsWith: string,
    credentialsInvalid: string,
    viewOnlyNode: boolean,
    zeroAddress: string,
    postersRef: React.RefObject<Record<string, Poster>>,
    rpcClientRef: React.RefObject<((method: string, params: any[], skipStateUpdate?: boolean) => Promise<any>)>,
    latestConversationActivity: string[],
    postersAddress: string,
    conversationsRef: React.RefObject<Record<string, Conversation>>,
    messagesRef: React.RefObject<Record<string, Message>>,
    browserStateHistoryRef: React.RefObject<Record<string, BrowserStateHistorySettings>>,
    setBrowserStateHistorySettings: (pageDomSetting: Partial<BrowserStateHistorySettings>, rerender?: boolean) => void,
    submittingMessage: string,
    submittingLike: string,
    inputPostDisabled: boolean,
    submitting: boolean,
    postMediaAttachmentsRef: React.RefObject<Record<string, PostMediaAttachment | undefined>>,
    handleOpenAddMediaModal: (e: MouseEventLocal, location: string, source: string) => void,
    handleExpandImageModal: (e: MouseEventLocal, image: File, cid?: string) => void,
    handleOpenLikesModal: (e: MouseEventLocal, likePosts: Message[]) => void,
    handleSubmitPubkeyModal: (e: MouseEventLocal, address: string) => void,
    handleOpenRpcSendMessageModal: (location: string, recipients: string[], replyToMessageId?: string | undefined) => void,
    messageSettingsInvalid: boolean,
    hostMessageCryptoEnabled?: boolean,
    handleSetInputCredentialsApplied: (newValue: boolean) => Promise<void>,
    findPostsWithRef: React.RefObject<string>,
    indexerApiUrlRef: React.RefObject<string>,
    replyPostsTreeRef: React.RefObject<Record<string, string>>,
    deOrphanedReplyPostsTreeRef: React.RefObject<Record<string, string>>,
    SET_NEW_POSTS_ADDED_DELAY: number,
    messagePrefix: string,
};

function Messages() {

    const {
        copyMessageTxHandler,
        submitMessageHandler,
        submitMessageLikeHandler,
        makePostsWith,
        zeroAddress,
        postersRef,
        rpcClientRef,
        latestConversationActivity,
        postersAddress,
        conversationsRef,
        messagesRef,
        browserStateHistoryRef,
        setBrowserStateHistorySettings,
        submittingMessage,
        submittingLike,
        inputPostDisabled,
        submitting,
        postMediaAttachmentsRef,
        handleOpenAddMediaModal,
        handleExpandImageModal,
        handleOpenLikesModal,
        handleSubmitPubkeyModal,
        handleOpenRpcSendMessageModal,
        messageSettingsInvalid,
        hostMessageCryptoEnabled,
        handleSetInputCredentialsApplied,
        findPostsWithRef,
        indexerApiUrlRef,
        replyPostsTreeRef,
        deOrphanedReplyPostsTreeRef,
        SET_NEW_POSTS_ADDED_DELAY,
        messagePrefix,
    } = useOutletContext() as MessagesProps;

    const [addNewRecipient, setAddNewRecipient] = useState<string>('');
    const [loadingNewRecipient, setLoadingNewRecipient] = useState<boolean>(false);
    const [addressInvalid, setAddressInvalid] = useState<string>('');
    const [importingDelivery, setImportingDelivery] = useState(false);

    const [recipients, setRecipients] = useState<string[]>([]);
    const recipientsRef = useRef(recipients);
    const postersAddressRef = useRef(postersAddress);
    const recipientInputRef = useRef<HTMLInputElement>(null);
    const mainTextareaRef = useRef<HTMLTextAreaElement>(null);
    const deliveryFileInputRef = useRef<HTMLInputElement>(null);
    recipientsRef.current = recipients;
    postersAddressRef.current = postersAddress;

    const [, forceUpdate] = useReducer(x => x + 1, 0);

    const mainPostMediaAttachment = postMediaAttachmentsRef.current['message-main'];

    useEffect(() => {
        handleSetInputCredentialsApplied(true);
    }, []);

    const addRecipient = async () => {
        if (importingDelivery) return;
        try {
            setLoadingNewRecipient(true);

            const candidate = addNewRecipient.trim().toLowerCase();

            if (!isValidAddress(candidate)) {
                setAddressInvalid('invalid format');
                throw new Error('invalid address format');
            }

            if (candidate === zeroAddress) {
                setAddressInvalid('zero address');
                throw new Error('cannot add zero address');
            }

            if (recipients.includes(candidate)) {
                throw new Error('already a recipient');
            }

            if (recipients.length >= 15) {
                throw new Error('a message can have at most 15 recipients');
            }

            const result = await resolveMessagingRecipient({
                address: candidate,
                posters: postersRef.current,
                preferredSource: findPostsWithRef.current,
                rpcClient: rpcClientRef.current,
                indexerApiUrl: indexerApiUrlRef.current,
            });

            if (result.error) {
                setAddressInvalid(result.error);
                throw new Error(result.error === 'pubkey missing'
                    ? 'recipient public key is not published yet'
                    : 'recipient not found');
            }

            setAddressInvalid('');
            setAddNewRecipient('');
            setRecipients(current => [ ...current, candidate ]);
        } catch (error) {
            alert(error instanceof Error ? error.message : String(error));
        } finally {
            setLoadingNewRecipient(false);
        }
    };

    const hasExistingDraft = () => Boolean(
        recipientsRef.current.length ||
        recipientInputRef.current?.value.trim() ||
        mainTextareaRef.current?.value ||
        postMediaAttachmentsRef.current['message-main']
    );

    const importFlipDelivery = async (file: File) => {
        if (inputPostDisabled || messageSettingsInvalid || loadingNewRecipient || importingDelivery) return;
        if (hasExistingDraft()) {
            alert('Clear the current draft and recipients before importing a flip delivery.');
            return;
        }

        setImportingDelivery(true);
        try {
            if (file.size > 2048) throw new Error('Flip delivery file exceeds 2048 bytes.');
            const text = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer());
            const delivery = parseDirectDelivery(text);
            if (!delivery) throw new Error('Invalid flip delivery file.');
            if (!isDirectDeliveryAuthor(delivery, postersAddressRef.current)) {
                throw new Error('This flip delivery belongs to a different author identity.');
            }

            const buyer = `0x${delivery.buyer}`;
            const result = await resolveMessagingRecipient({
                address: buyer,
                posters: postersRef.current,
                preferredSource: findPostsWithRef.current,
                rpcClient: rpcClientRef.current,
                indexerApiUrl: indexerApiUrlRef.current,
            });
            if (result.error) {
                throw new Error(result.error === 'pubkey missing'
                    ? 'Buyer public key is not published yet.'
                    : 'Buyer recipient was not found.');
            }
            if (!isDirectDeliveryAuthor(delivery, postersAddressRef.current)) {
                throw new Error('The active author identity changed during import.');
            }
            if (hasExistingDraft() || !mainTextareaRef.current) {
                throw new Error('The message draft changed during import. Clear it before trying again.');
            }

            mainTextareaRef.current.value = delivery.text;
            recipientsRef.current = [buyer];
            setRecipients([buyer]);
            mainTextareaRef.current.focus();
        } catch (error) {
            alert(error instanceof Error ? error.message : String(error));
        } finally {
            setImportingDelivery(false);
        }
    };

    const removeMediaHandler = (e: MouseEventLocal, location: string) => {
        e?.stopPropagation();

        postMediaAttachmentsRef.current = { ...postMediaAttachmentsRef.current, [`message-${location}`]: undefined };
        forceUpdate();
    };

    const localCopyMessageTxHandler = async (location: string, replyToMessageId?: string) => {
        if (!recipients.length) {
            alert('No recipients');
            return;
        }
        copyMessageTxHandler(location, recipients, replyToMessageId);
    };

    const localSubmitMessageHandler = async (location: string, replyToMessageId?: string) => {
        if (!recipients.length) {
            alert('No recipients');
            return;
        }

        if (recipients.some(recipient => !postersRef.current[recipient]?.pubkey)) {
            alert('Recipient public key missing');
            return;
        }

        makePostsWith === 'rpc' ? handleOpenRpcSendMessageModal(location, recipients, replyToMessageId) : submitMessageHandler(location, recipients, replyToMessageId);
    };

    const removeRecipient = (recipient: string) => {
        setRecipients(recipients.filter((item) => item !== recipient));
    };

    return (<>
        <PageHeaderComponent title="Messages" />
        <div className="flex flex-col gap-3 border-b border-line px-4 py-3">
            {!messageSettingsInvalid && hostMessageCryptoEnabled && <p className="text-[13px] text-tip">Desktop encryption ready. Your identity key stays outside this embedded page.</p>}
            {messageSettingsInvalid && <p className="text-[13px] text-danger">Messaging is disabled because there is a problem with your settings. Please adjust your settings and return to this page.</p>}
            <div className="flex flex-col gap-1.5">
                <p className="text-[13px] text-ink-muted">To</p>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <input ref={recipientInputRef} className="form-field min-w-0 flex-1 text-[12px] md:text-[15px]" placeholder="Recipient address (0x...)" value={addNewRecipient} onChange={e => { setAddressInvalid(''); setAddNewRecipient(e.target.value); }} />
                    <button type="button" className="btn-outline h-8 flex-none self-start px-4 text-[14px] sm:self-auto" disabled={loadingNewRecipient || importingDelivery} onClick={() => addRecipient()}>
                        <UserPlusIcon className="size-4" />
                        {loadingNewRecipient ? 'Loading...' : 'Add Recipient'}
                    </button>
                </div>
                {addressInvalid && <div className="flex flex-wrap gap-x-2 text-[13px] text-danger">
                    <span>{addressInvalid === 'pubkey missing' ? 'Recipient public key is not published yet.' : `Invalid address: ${addressInvalid}.`}</span>
                    {addressInvalid === 'pubkey missing' && addNewRecipient.trim() && addNewRecipient.trim().toLowerCase() !== zeroAddress && <><span className="cursor-pointer text-accent hover:underline" onClick={(e) => handleSubmitPubkeyModal(e, addNewRecipient.trim().toLowerCase())}>Manually Provide Pubkey</span><span>then try again</span></>}
                </div>}
            </div>
            {!!recipients.length && <div className="flex flex-col gap-1.5">
                <p className="text-[13px] text-ink-muted">Recipients</p>
                <div className="flex flex-wrap gap-2">
                    {recipients.map(recipient => <div key={recipient} className="inline-flex min-h-8 max-w-full items-center gap-1 rounded-full border border-line-strong pr-1 pl-3 text-[13px] sm:text-[14px]">
                        <span className="min-w-0 break-all">{recipient}</span>
                        <button type="button" aria-label="Remove recipient" title="Remove recipient" className="inline-flex size-6 flex-none cursor-pointer items-center justify-center rounded-full hover:bg-ink/10" onClick={() => removeRecipient(recipient)}>
                            <CloseIcon className="size-3.5" />
                        </button>
                    </div>)}
                </div>
            </div>}
            <input ref={deliveryFileInputRef} type="file" className="hidden" onChange={e => {
                const file = e.currentTarget.files?.[0];
                e.currentTarget.value = '';
                if (file) void importFlipDelivery(file);
            }} />
            <button type="button" className="mb-2 text-accent text-[12px] hover:underline cursor-pointer disabled:opacity-50" disabled={inputPostDisabled || messageSettingsInvalid || loadingNewRecipient || importingDelivery} onClick={() => deliveryFileInputRef.current?.click()}>
                {importingDelivery ? 'Importing...' : 'Import flip delivery'}
            </button>
            <textarea
                id='message-input-main'
                ref={mainTextareaRef}
                rows={4}
                className="field-sizing-content max-h-[520px] min-h-[104px] w-full resize-none rounded-2xl bg-field px-4 py-3 text-[15px]/5 outline-none scrollbar-thin placeholder:text-ink-muted focus:ring-1 focus:ring-accent"
                placeholder="Start a new message"
                disabled={inputPostDisabled || submitting || messageSettingsInvalid}
            />
            {mainPostMediaAttachment && <div className="relative w-fit">
                <ObjectUrlImageComponent className="max-h-120 max-w-full sm:max-w-100 size-auto rounded-2xl border border-line" file={mainPostMediaAttachment.file} />
                <button type="button" aria-label="Remove image" title="Remove image" className="absolute top-1 left-1 inline-flex size-8 cursor-pointer items-center justify-center rounded-full bg-black/75 text-white backdrop-blur-sm hover:bg-black/60" onClick={(e) => removeMediaHandler(e, 'main')}>
                    <CloseIcon className="size-[18px]" />
                </button>
            </div>}
            <ComposerToolbarComponent
                hasAttachment={!!mainPostMediaAttachment}
                onAddImage={(e) => handleOpenAddMediaModal(e, 'main', 'message')}
                onRemoveImage={(e) => removeMediaHandler(e, 'main')}
                copyTxId="message-copytx-main"
                onCopyTx={() => !inputPostDisabled && !submitting && !messageSettingsInvalid && localCopyMessageTxHandler('main')}
                submitText={submittingMessage === 'main' ? 'Sending...' : 'Send'}
                onSubmit={() => localSubmitMessageHandler('main')}
                submitDisabled={inputPostDisabled || submitting || messageSettingsInvalid || importingDelivery}
            />
        </div>
        <div>
            {!!latestConversationActivity.length && latestConversationActivity.map(conversationKey => {
                return <ConversationComponent
                    key={conversationKey}
                    conversationKey={conversationKey}
                    postersAddress={postersAddress}
                    replyPostsTreeRef={replyPostsTreeRef}
                    deOrphanedReplyPostsTreeRef={deOrphanedReplyPostsTreeRef}
                    postersRef={postersRef}
                    conversationsRef={conversationsRef}
                    messagesRef={messagesRef}
                    postMediaAttachmentsRef={postMediaAttachmentsRef}
                    browserStateHistoryRef={browserStateHistoryRef}
                    setBrowserStateHistorySettings={setBrowserStateHistorySettings}
                    inputPostDisabled={inputPostDisabled}
                    submitting={submitting}
                    messageSettingsInvalid={messageSettingsInvalid}
                    copyMessageTxHandler={copyMessageTxHandler}
                    submitMessageHandler={submitMessageHandler}
                    submitMessageLikeHandler={submitMessageLikeHandler}
                    makePostsWith={makePostsWith}
                    handleOpenRpcSendMessageModal={handleOpenRpcSendMessageModal}
                    SET_NEW_POSTS_ADDED_DELAY={SET_NEW_POSTS_ADDED_DELAY}
                    handleOpenLikesModal={handleOpenLikesModal}
                    handleSubmitPubkeyModal={handleSubmitPubkeyModal}
                    handleOpenAddMediaModal={handleOpenAddMediaModal}
                    handleExpandImageModal={handleExpandImageModal}
                    submittingMessage={submittingMessage}
                    submittingLike={submittingLike}
                    messagePrefix={messagePrefix}
                />;
            })}
        </div>
    </>);
}

export default Messages;
