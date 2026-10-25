import { MAX_POST_MEDIA_BYTES_RPC, type Post, type Poster, type PostTips, type RpcPostCostEstimate } from './logic/asyncUtils';
import { useLocation, useOutletContext } from 'react-router';
import PostComponent from './components/PostComponent';
import { type BrowserStateHistorySettings, type MouseEventLocal, type PostMediaAttachment } from './App.exports';
import { useEffect, useReducer, useRef, useState } from 'react';
import type { DesktopBootstrap } from './logic/desktopBootstrap';
import SortPostsByComponent from './components/SortPostsByComponent';
import ObjectUrlImageComponent from './components/ObjectUrlImageComponent';
import type { SocialContractOption } from './logic/socialContracts';
import { isRenderableTopLevelPost } from './logic/feedVisibility';
import PageHeaderComponent from './components/PageHeaderComponent';
import ComposerToolbarComponent from './components/ComposerToolbarComponent';

type LatestPostsProps = {
    currentBlockCaptured: number,
    nodeAvailable: boolean,
    latestPosts: string[],
    latestActivity: string[],
    postsRef: React.RefObject<Record<string, Post>>,
    postersRef: React.RefObject<Record<string, Poster>>,
    replyPostsTreeRef: React.RefObject<Record<string, string>>,
    deOrphanedReplyPostsTreeRef: React.RefObject<Record<string, string>>,
    discussPrefix: string,
    scanningPastBlocks: boolean,
    setScanningPastBlocks: React.Dispatch<React.SetStateAction<boolean>>,
    noMorePastBlocks: boolean,
    pastBlockCaptured: number,
    SET_NEW_POSTS_ADDED_DELAY: number,
    inputPostDisabled: boolean,
    submitting: boolean,
    copyPostTxHandler: (location: string, replyToPostId?: string | undefined, channelId?: string | undefined) => Promise<void>,
    submitPostHandler: (location: string, replyToPostId?: string | undefined, channelId?: string | undefined, storeTextIpfs?: boolean | undefined, storeMediaIpfs?: boolean | undefined) => Promise<void>,
    submitLikeHandler: (emoji: string, location: string, replyToPostId?: string | undefined, channelId?: string | undefined) => Promise<void>,
    submittingPost: string,
    submittingLike: string,
    submittingTip: string,
    browserStateHistoryRef: React.RefObject<Record<string, BrowserStateHistorySettings>>,
    setBrowserStateHistorySettings: (pageDomSetting: Partial<BrowserStateHistorySettings>, rerender?: boolean) => void,
    handleOpenLikesModal: (e: MouseEventLocal, likePosts: Post[]) => void,
    handleOpenTipsModal: (e: MouseEventLocal, likePosts: string[]) => void,
    handleOpenSendTipModal: (e: MouseEventLocal, location: string, tipToPost: Post) => void,
    handleOpenAddMediaModal: (e: MouseEventLocal, location: string, source: string) => void,
    handleOpenRpcMakePostModal: (e: MouseEventLocal, location: string, replyToPostId?: string, channelId?: string) => void,
    handleExpandImageModal: (e: MouseEventLocal, image: File, cid?: string) => void,
    postTipsRef: React.RefObject<Record<string, PostTips>>,
    postMediaAttachmentsRef: React.RefObject<Record<string, PostMediaAttachment | undefined>>,
    makePostsWith: string,
    estimatePostCostHandler: (inputText: string, mediaFile?: File | undefined) => Promise<RpcPostCostEstimate | null>,
    mainComposerCostEstimate: RpcPostCostEstimate | null,
    setMainComposerCostEstimate: React.Dispatch<React.SetStateAction<RpcPostCostEstimate | null>>,
    mainComposerCostEstimateError: string,
    setMainComposerCostEstimateError: React.Dispatch<React.SetStateAction<string>>,
    mainComposerCostEstimateLoading: boolean,
    setMainComposerCostEstimateLoading: React.Dispatch<React.SetStateAction<boolean>>,
    inputSendingTxs: string,
    embeddedDesktopOnchainMode?: boolean,
    desktopBootstrap?: DesktopBootstrap,
    activeSocialContract: SocialContractOption,
    activeContractAddress: string,
};

function HoverInfo({ label, widthClass = 'w-72' }: { label: string, widthClass?: string }) {
    const [open, setOpen] = useState(false);

    return (
        <span
            className="relative ml-1 inline-flex align-middle"
            onMouseEnter={() => setOpen(true)}
            onMouseLeave={() => setOpen(false)}
        >
            <span className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-stone-500 text-[10px] font-[700] text-ink-muted hover:cursor-help">i</span>
            <span
                className={`pointer-events-none absolute left-1/2 top-full z-50 mt-2 -translate-x-1/2 rounded-md border border-line bg-surface px-3 py-2 text-left text-[11px] leading-4 text-ink shadow-2xl ${widthClass}`}
                style={{ display: open ? 'block' : 'none' }}
            >
                {label}
            </span>
        </span>
    );
}

function LatestPosts() {
    const location = useLocation();

    const { key: locationKey } = location;

    const {
        currentBlockCaptured,
        nodeAvailable,
        latestPosts,
        latestActivity,
        postsRef,
        postersRef,
        replyPostsTreeRef,
        deOrphanedReplyPostsTreeRef,
        discussPrefix,
        SET_NEW_POSTS_ADDED_DELAY,
        inputPostDisabled,
        submitting,
        copyPostTxHandler,
        submitPostHandler,
        submitLikeHandler,
        submittingPost,
        submittingLike,
        submittingTip,
        browserStateHistoryRef,
        setBrowserStateHistorySettings,
        handleOpenLikesModal,
        handleOpenTipsModal,
        handleOpenSendTipModal,
        handleOpenAddMediaModal,
        handleOpenRpcMakePostModal,
        handleExpandImageModal,
        postTipsRef,
        postMediaAttachmentsRef,
        makePostsWith,
        estimatePostCostHandler,
        mainComposerCostEstimate,
        setMainComposerCostEstimate,
        mainComposerCostEstimateError,
        setMainComposerCostEstimateError,
        mainComposerCostEstimateLoading,
        setMainComposerCostEstimateLoading,
        inputSendingTxs,
        embeddedDesktopOnchainMode,
        desktopBootstrap,
        activeSocialContract,
        activeContractAddress,
    } = useOutletContext() as LatestPostsProps;

    const [, forceUpdate] = useReducer(x => x + 1, 0);
    const [mainDraftText, setMainDraftText] = useState('');
    const lastAppliedPrefillRef = useRef('');
    const proposalMode = desktopBootstrap?.proposalMode === true;
    const proposalPublishingEnabled = proposalMode
        ? desktopBootstrap?.proposalPublishingEnabled !== false
        : true;
    const proposalTag = desktopBootstrap?.proposalTag || '#IdenaDAO';
    const normalizedProposalTag = proposalTag.trim().toLowerCase();
    const proposalComposerPlaceholder = desktopBootstrap?.composerPlaceholder
        || 'Draft your governance proposal here.';
    const proposalComposerHint = desktopBootstrap?.composerHint
        || `Only posts containing ${proposalTag} are surfaced in this governance view.`;
    const proposalPrefillText = desktopBootstrap?.composerPrefillText || '';
    const mainComposerDisabled = inputPostDisabled || (proposalMode && !proposalPublishingEnabled);

    if (!browserStateHistoryRef.current[locationKey]?.sortPostsBy) {
        setBrowserStateHistorySettings({ sortPostsBy: 'latest-posts' });
    }

    const sortPostsBy = browserStateHistoryRef.current[locationKey].sortPostsBy;
    const sortedPostIds = sortPostsBy === 'latest-posts' ? latestPosts : latestActivity;
    const mainPostMediaAttachment = postMediaAttachmentsRef.current['post-main'];
    const mainFeeTooltipText = mainComposerCostEstimate
        ? `Current conservative max-fee cap from your own node RPC: about ${mainComposerCostEstimate.totalMaxFeeDna} iDNA. Breakdown: contract call ${mainComposerCostEstimate.contractCallMaxFeeDna} iDNA${mainComposerCostEstimate.imageStoredToIpfs ? `, image storage ${mainComposerCostEstimate.imageStoreMaxFeeDna} iDNA` : ''}${mainComposerCostEstimate.textStoredToIpfs ? `, long-text storage ${mainComposerCostEstimate.textStoreMaxFeeDna} iDNA` : ''}. The actual charged fee can be lower.`
        : 'Start typing or attach an image to request a conservative max-fee estimate from your own node RPC.';
    const renderablePostIds = sortedPostIds.filter((postId) =>
        isRenderableTopLevelPost(postsRef.current[postId])
    );
    const visiblePostIds = proposalMode
        ? renderablePostIds.filter((postId) => {
            const post = postsRef.current[postId];
            return !post?.replyToPostId && !!post?.message?.toLowerCase().includes(normalizedProposalTag);
        })
        : renderablePostIds;

    useEffect(() => {
        if (!proposalMode) {
            lastAppliedPrefillRef.current = '';
            return;
        }

        if (lastAppliedPrefillRef.current === proposalPrefillText) {
            return;
        }

        const previousPrefill = lastAppliedPrefillRef.current;
        lastAppliedPrefillRef.current = proposalPrefillText;

        setMainDraftText((currentValue) => {
            if (!currentValue.trim() || currentValue === previousPrefill) {
                return proposalPrefillText;
            }

            return currentValue;
        });
    }, [proposalMode, proposalPrefillText]);

    useEffect(() => {
        if (submittingPost !== 'main') {
            return undefined;
        }

        const clearDraftTimer = window.setTimeout(() => {
            setMainDraftText('');
            setMainComposerCostEstimate(null);
            setMainComposerCostEstimateError('');
        }, 0);

        return () => window.clearTimeout(clearDraftTimer);
    }, [
        setMainComposerCostEstimate,
        setMainComposerCostEstimateError,
        submittingPost,
    ]);

    useEffect(() => {
        let canceled = false;
        const runEstimate = async () => {
            setMainComposerCostEstimateError('');

            if (inputSendingTxs !== 'rpc' || mainComposerDisabled) {
                setMainComposerCostEstimate(null);
                setMainComposerCostEstimateLoading(false);
                return;
            }

            if (!mainDraftText && !mainPostMediaAttachment?.file) {
                setMainComposerCostEstimate(null);
                setMainComposerCostEstimateLoading(false);
                return;
            }

            setMainComposerCostEstimateLoading(true);

            try {
                const estimateMediaFile = mainPostMediaAttachment?.ipfsUrl ? undefined : mainPostMediaAttachment?.file;
                const estimate = await estimatePostCostHandler(mainDraftText, estimateMediaFile);
                if (!canceled) {
                    setMainComposerCostEstimate(estimate);
                }
            } catch {
                if (!canceled) {
                    setMainComposerCostEstimate(null);
                    setMainComposerCostEstimateError('Fee estimate unavailable right now.');
                }
            } finally {
                if (!canceled) {
                    setMainComposerCostEstimateLoading(false);
                }
            }
        };

        const timeoutId = setTimeout(runEstimate, 350);

        return () => {
            canceled = true;
            clearTimeout(timeoutId);
        };
    }, [
        estimatePostCostHandler,
        inputSendingTxs,
        mainComposerDisabled,
        mainDraftText,
        mainPostMediaAttachment?.file,
        mainPostMediaAttachment?.ipfsUrl,
        setMainComposerCostEstimate,
        setMainComposerCostEstimateError,
        setMainComposerCostEstimateLoading,
    ]);
    const removeMediaHandler = (e: MouseEventLocal, location: string) => {
        e?.stopPropagation();

        postMediaAttachmentsRef.current = { ...postMediaAttachmentsRef.current, [`post-${location}`]: undefined };
        forceUpdate();
    };

    return (<>
        <div
            className={`mt-3 mb-6 ${embeddedDesktopOnchainMode ? 'mx-auto w-full max-w-[1360px]' : 'w-full'}`}
            style={embeddedDesktopOnchainMode ? { width: '100%', maxWidth: '1360px' } : undefined}
        >
            {proposalMode && (
                <div className="mb-3 rounded-md border border-accent/30 bg-blue-500/10 px-4 py-3 text-[13px] text-ink">
                    <p className="font-[700]">IdenaDAO proposal mode</p>
                    <p className="mt-1 text-ink-muted">{proposalComposerHint}</p>
                    {!proposalPublishingEnabled && (
                        <p className="mt-2 text-amber-700">
                            Validation is required before this governance composer can publish a new proposal.
                        </p>
                    )}
                </div>
            )}
            <textarea
                id='post-input-main'
                rows={4}
                className="block w-full resize-none bg-transparent outline-none text-xl/6 py-3 px-4 placeholder:text-ink-muted field-sizing-content min-h-[104px] max-h-[520px] scrollbar-thin"
                placeholder={proposalMode ? proposalComposerPlaceholder : 'Write your post here...'}
                disabled={mainComposerDisabled}
                value={mainDraftText}
                onChange={(event) => setMainDraftText(event.target.value)}
            />
            {mainPostMediaAttachment && <div className="mx-4 my-1">
                <ObjectUrlImageComponent className="max-h-[640px] w-auto max-w-full rounded-sm" file={mainPostMediaAttachment.file} />
            </div>}
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-ink-muted">
                <p>
                    <strong>Image limit:</strong> {(MAX_POST_MEDIA_BYTES_RPC / (1024 * 1024)).toFixed(0)} MB
                    <HoverInfo label="Supported formats: PNG, JPEG, GIF, WebP, AVIF, APNG, SVG. The current embedded RPC limit is 1 MB. In desktop RPC mode the file is stored through your own node IPFS path first and then referenced on-chain by CID." />
                </p>
                <p>
                    <strong>Posting model:</strong> RPC + on-chain reference
                    <HoverInfo label="When enabled in the RPC posting dialog, text and local images add dna_storeToIpfs transactions before the contract call. Existing IPFS images are referenced directly." />
                </p>
                <p className={activeSocialContract.legacy ? 'text-amber-700' : ''}>
                    <strong>Contract:</strong> {activeSocialContract.shortLabel}
                    <HoverInfo label={`Calls are sent to ${activeSocialContract.address}. Use the advanced contract target control above to switch back to the current contract.`} widthClass="w-80" />
                </p>
                <p>
                    <strong>Current max-fee:</strong>{' '}
                    {mainComposerCostEstimateLoading
                        ? 'estimating…'
                        : mainComposerCostEstimate
                            ? `about ${mainComposerCostEstimate.totalMaxFeeDna} iDNA`
                            : mainComposerCostEstimateError || 'start typing or attach an image'}
                    <HoverInfo label={mainFeeTooltipText} widthClass="w-80" />
                </p>
                {mainComposerCostEstimateError && !mainComposerCostEstimateLoading && (
                    <p className="text-danger">{mainComposerCostEstimateError}</p>
                )}
            </div>
            <div className="mt-3 border-t border-line pt-2">
                <ComposerToolbarComponent
                    hasAttachment={!!mainPostMediaAttachment}
                    onAddImage={(e) => !mainComposerDisabled && handleOpenAddMediaModal(e, 'main', 'post')}
                    onRemoveImage={(e) => !mainComposerDisabled && removeMediaHandler(e, 'main')}
                    copyTxId="post-copytx-main"
                    onCopyTx={() => !mainComposerDisabled && copyPostTxHandler('main')}
                    submitText={submittingPost === 'main' ? 'Posting...' : 'Post'}
                    onSubmit={(e) => makePostsWith === 'rpc' ? handleOpenRpcMakePostModal(e, 'main') : submitPostHandler('main')}
                    submitDisabled={mainComposerDisabled}
                    hint="Your post will take time to display due to blockchain acceptance."
                />
                {proposalMode && proposalPrefillText && <button type="button" className="mt-2 text-[13px] text-accent hover:underline" disabled={mainComposerDisabled} onClick={() => setMainDraftText(proposalPrefillText)}>Restore template</button>}
            </div>
        </div>
        {proposalMode && visiblePostIds.length === 0 && (
            <div className="my-4 rounded-md border border-line bg-surface px-4 py-3 text-[13px] text-ink-muted">
                No tagged IdenaDAO proposals are visible yet. Publish a post that includes {proposalTag} to seed this governance feed.
            </div>
        )}
        <div className="text-center my-3">
            <p>Current Block: #{currentBlockCaptured ? currentBlockCaptured : (nodeAvailable ? 'Loading...' : '')}</p>
            {!nodeAvailable && <p className="text-[11px] text-danger">Blocks are not being captured. Please update your node.</p>}
        </div>
        <PageHeaderComponent sticky={false}>
            <SortPostsByComponent sortPostsBy={sortPostsBy} setBrowserStateHistorySettings={setBrowserStateHistorySettings} />
        </PageHeaderComponent>
        <ul>
            {visiblePostIds.map((postId) => (
                <li key={postId}>
                    <PostComponent
                        uniqueKey={postId}
                        postId={postId}
                        postsRef={postsRef}
                        postersRef={postersRef}
                        replyPostsTreeRef={replyPostsTreeRef}
                        deOrphanedReplyPostsTreeRef={deOrphanedReplyPostsTreeRef}
                        discussPrefix={discussPrefix}
                        SET_NEW_POSTS_ADDED_DELAY={SET_NEW_POSTS_ADDED_DELAY}
                        inputPostDisabled={inputPostDisabled}
                        submitting={submitting}
                        copyPostTxHandler={copyPostTxHandler}
                        submitPostHandler={submitPostHandler}
                        submitLikeHandler={submitLikeHandler}
                        submittingPost={submittingPost}
                        submittingLike={submittingLike}
                        submittingTip={submittingTip}
                        browserStateHistoryRef={browserStateHistoryRef}
                        setBrowserStateHistorySettings={setBrowserStateHistorySettings}
                        handleOpenLikesModal={handleOpenLikesModal}
                        handleOpenTipsModal={handleOpenTipsModal}
                        handleOpenSendTipModal={handleOpenSendTipModal}
                        handleOpenAddMediaModal={handleOpenAddMediaModal}
                        handleOpenRpcMakePostModal={handleOpenRpcMakePostModal}
                        handleExpandImageModal={handleExpandImageModal}
                        postTipsRef={postTipsRef}
                        postMediaAttachmentsRef={postMediaAttachmentsRef}
                        makePostsWith={makePostsWith}
                        activeContractAddress={activeContractAddress}
                    />
                </li>
            ))}
        </ul>
    </>);
}

export default LatestPosts;
