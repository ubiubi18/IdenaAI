import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import ConversationComponent from './ConversationComponent';

const renderConversation = (
    conversations: Record<string, string[]>,
    messages: Record<string, any> = {},
    posters: Record<string, any> = {},
    replyPostsTree: Record<string, string> = {},
    deOrphanedReplyPostsTree: Record<string, string> = {},
) => renderToStaticMarkup(
    <MemoryRouter initialEntries={['/conversation/missing']}>
        <ConversationComponent
            conversationKey="missing"
            postersAddress="0x0000000000000000000000000000000000000001"
            replyPostsTreeRef={{ current: replyPostsTree }}
            deOrphanedReplyPostsTreeRef={{ current: deOrphanedReplyPostsTree }}
            postersRef={{ current: posters }}
            conversationsRef={{ current: conversations }}
            messagesRef={{ current: messages }}
            postMediaAttachmentsRef={{ current: {} }}
            browserStateHistoryRef={{ current: {} }}
            setBrowserStateHistorySettings={vi.fn()}
            inputPostDisabled={false}
            messageSettingsInvalid={false}
            copyMessageTxHandler={vi.fn()}
            submitMessageHandler={vi.fn()}
            submitMessageLikeHandler={vi.fn()}
            makePostsWith="rpc"
            handleOpenRpcSendMessageModal={vi.fn()}
            SET_NEW_POSTS_ADDED_DELAY={20}
            handleOpenLikesModal={vi.fn()}
            handleSubmitPubkeyModal={vi.fn()}
            handleOpenAddMediaModal={vi.fn()}
            handleExpandImageModal={vi.fn()}
            submittingMessage=""
            submittingLike=""
            messagePrefix="message:"
            isConversationOutlet={true}
        />
    </MemoryRouter>,
);

describe('ConversationComponent route hydration', () => {
    it('renders an unavailable state instead of throwing for an unknown route key', () => {
        const markup = renderConversation({});

        expect(markup).toContain('conversation is not available yet');
        expect(markup).toContain('role="status"');
    });

    it('renders a loading state while participant details are unresolved', () => {
        const sender = '0x0000000000000000000000000000000000000001';
        const recipient = '0x0000000000000000000000000000000000000002';
        const markup = renderConversation(
            { missing: ['1'] },
            {
                1: {
                    messageId: '1',
                    participants: [sender, recipient],
                },
            },
        );

        expect(markup).toContain('participant details are still loading');
        expect(markup).toContain('role="status"');
    });

    it('keeps message reactions out of the timeline while counting them on their parent', () => {
        const sender = '0x0000000000000000000000000000000000000001';
        const recipient = '0x0000000000000000000000000000000000000002';
        const messageDetails = { stake: 1, state: 'Human', age: 2 };
        const markup = renderConversation(
            { missing: ['1', '2'] },
            {
                1: {
                    timestamp: 1,
                    txHash: 'visible-message-transaction',
                    messageId: '1',
                    sender,
                    participants: [sender, recipient],
                    conversationKey: 'missing',
                    channelId: '',
                    message: 'visible parent message',
                    replyToMessageId: '',
                    tags: [],
                    textPassword: '',
                    mediaPassword: '',
                    sendersDetails_atTimeOfMessage: messageDetails,
                    isLike: false,
                    orphaned: false,
                },
                2: {
                    timestamp: 2,
                    txHash: 'reaction-only-transaction',
                    messageId: '2',
                    sender: recipient,
                    participants: [sender, recipient],
                    conversationKey: 'missing',
                    channelId: '',
                    message: '❤️',
                    replyToMessageId: '1',
                    tags: [],
                    textPassword: '',
                    mediaPassword: '',
                    sendersDetails_atTimeOfMessage: messageDetails,
                    isLike: true,
                    orphaned: false,
                },
            },
            {
                [recipient]: {
                    address: recipient,
                    age: 2,
                    pubkey: 'recipient-public-key',
                    stake: '1',
                    state: 'Human',
                },
            },
            { 'message:1-0': '2' },
        );

        expect(markup).toContain('Messages (1)');
        expect(markup).toContain('visible parent message');
        expect(markup).toContain('visible-message-transaction');
        expect(markup).not.toContain('reaction-only-transaction');
        expect(markup).toContain('cursor-pointer">1</a>');
    });
});
