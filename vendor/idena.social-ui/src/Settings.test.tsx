import { beforeEach, describe, expect, it, vi } from 'vitest';
import Settings from './Settings';

const state = vi.hoisted(() => ({
    context: {} as Record<string, any>,
    initialNode: {url: 'http://localhost:9009', key: ''},
    navigate: vi.fn(),
    clearRange: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('react', async importOriginal => ({
    ...await importOriginal<typeof import('react')>(),
    useEffect: () => {},
    useRef: () => ({current: state.initialNode}),
}));
vi.mock('react-router', () => ({
    useNavigate: () => state.navigate,
    useOutletContext: () => state.context,
}));
vi.mock('./logic/blocksCapturedStore', () => ({
    clearBlocksCapturedRange: state.clearRange,
}));

const findButton = (node: any, label: string): any => {
    if (Array.isArray(node)) {
        for (const child of node) {
            const found = findButton(child, label);
            if (found) return found;
        }
    } else if (node && typeof node === 'object') {
        if (node.type === 'button' && node.props['aria-label'] === label) return node;
        return findButton(node.props?.children, label);
    }
};

describe('social settings account changes', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        state.context = {
            inputNodeUrl: state.initialNode.url,
            inputNodeKey: '',
            inputNodeApplied: false,
            inputSendingTxs: 'idena-app',
            inputPostersAddressApplied: false,
            postersAddress: `0x${'ab'.repeat(20)}`,
            inputPostersAddress: `0x${'cd'.repeat(20)}`,
            setInputNodeApplied: vi.fn(),
            setInputPostersAddressApplied: vi.fn(),
            setEncryptedPrivateKey: vi.fn(),
            setPassword: vi.fn(),
        };
    });

    it('clears the previous account credentials and rescans after applying another address', async () => {
        findButton(Settings(), 'Apply address').props.onClick();
        await Promise.resolve();
        expect(state.context.setInputPostersAddressApplied).toHaveBeenCalledWith(true);
        expect(state.context.setEncryptedPrivateKey).toHaveBeenCalledWith('');
        expect(state.context.setPassword).toHaveBeenCalledWith('');
        expect(state.clearRange).toHaveBeenCalledOnce();
        expect(state.navigate).toHaveBeenCalledWith(0);
    });

    it('keeps the cache and credentials when only address casing changes', () => {
        state.context.inputPostersAddress = state.context.postersAddress.toUpperCase();
        findButton(Settings(), 'Apply address').props.onClick();
        expect(state.clearRange).not.toHaveBeenCalled();
        expect(state.context.setPassword).not.toHaveBeenCalled();
        expect(state.context.setEncryptedPrivateKey).not.toHaveBeenCalled();
    });

    it('rescans when applying a different node', async () => {
        state.context.inputNodeUrl = 'http://localhost:9010';
        findButton(Settings(), 'Apply node settings').props.onClick();
        await Promise.resolve();
        expect(state.clearRange).toHaveBeenCalledOnce();
        expect(state.navigate).toHaveBeenCalledWith(0);
    });

    it('does not clear data merely to edit node settings', () => {
        state.context.inputNodeApplied = true;
        findButton(Settings(), 'Change node settings').props.onClick();
        expect(state.context.setInputNodeApplied).toHaveBeenCalledWith(false);
        expect(state.clearRange).not.toHaveBeenCalled();
    });
});
