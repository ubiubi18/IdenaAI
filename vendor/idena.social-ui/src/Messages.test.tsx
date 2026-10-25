import { describe, expect, it, vi } from 'vitest';
import Messages from './Messages';
import ComposerToolbarComponent from './components/ComposerToolbarComponent';

const state = vi.hoisted(() => ({
    hookIndex: 0,
    recipients: [] as string[],
    context: {} as Record<string, any>,
}));

vi.mock('react', async importOriginal => {
    const react = await importOriginal<typeof import('react')>();
    return {
        ...react,
        useEffect: () => {},
        useReducer: () => [0, () => {}],
        useRef: (value: unknown) => ({ current: value }),
        useState: (initial: unknown) => {
            // The fifth state slot is the recipient list in Messages.
            if (state.hookIndex++ !== 4) return [initial, () => {}];
            return [state.recipients, (next: string[] | ((current: string[]) => string[])) => {
                state.recipients = typeof next === 'function' ? next(state.recipients) : next;
            }];
        },
    };
});

vi.mock('react-router', () => ({
    useNavigate: () => () => {},
    useOutletContext: () => state.context,
}));

const findSendButton = (node: any): any => {
    if (Array.isArray(node)) {
        for (const child of node) {
            const found = findSendButton(child);
            if (found) return found;
        }
    } else if (node && typeof node === 'object') {
        if (node.type === ComposerToolbarComponent) return findSendButton(ComposerToolbarComponent(node.props));
        if (node.type === 'button' && node.props?.children === 'Send') return node;
        return findSendButton(node.props?.children);
    }
};

describe('message composer retry', () => {
    it.each(['rpc', 'idena-app'])('keeps the buyer recipient after handing off a %s send', async makePostsWith => {
        const buyer = `0x${'b'.repeat(40)}`;
        state.hookIndex = 0;
        state.recipients = [buyer];
        state.context = {
            makePostsWith,
            postersRef: { current: { [buyer]: { pubkey: 'buyer-public-key' } } },
            postMediaAttachmentsRef: { current: {} },
            postersAddress: `0x${'a'.repeat(40)}`,
            latestConversationActivity: [],
            inputPostDisabled: false,
            messageSettingsInvalid: false,
            submittingMessage: '',
            handleOpenRpcSendMessageModal: vi.fn(),
            submitMessageHandler: vi.fn().mockResolvedValue(undefined),
        };

        const sendButton = findSendButton(Messages());
        expect(sendButton).toBeDefined();
        await sendButton.props.onClick();

        expect(state.recipients).toEqual([buyer]);
        if (makePostsWith === 'rpc') {
            expect(state.context.handleOpenRpcSendMessageModal).toHaveBeenCalledWith('main', [buyer], undefined);
            expect(state.context.submitMessageHandler).not.toHaveBeenCalled();
        } else {
            expect(state.context.submitMessageHandler).toHaveBeenCalledWith('main', [buyer], undefined);
        }
    });
});
