import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import ConversationComponent from './ConversationComponent';

const renderConversation = (
    conversations: Record<string, string[]>,
    messages: Record<string, any> = {},
    posters: Record<string, any> = {},
) => renderToStaticMarkup(
    <MemoryRouter initialEntries={['/conversation/missing']}>
        <ConversationComponent
            conversationKey="missing"
            postersAddress="0x0000000000000000000000000000000000000001"
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
            makePostsWith="rpc"
            handleOpenRpcSendMessageModal={vi.fn()}
            SET_NEW_POSTS_ADDED_DELAY={20}
            handleSubmitPubkeyModal={vi.fn()}
            handleOpenAddMediaModal={vi.fn()}
            handleExpandImageModal={vi.fn()}
            submittingMessage=""
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
});
