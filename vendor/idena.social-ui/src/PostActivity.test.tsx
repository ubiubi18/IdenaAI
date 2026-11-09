import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Outlet, Route, Routes } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import PostActivity from './PostActivity';

vi.mock('./components/PostComponent', () => ({
    default: ({ postId, activeContractAddress }: { postId: string, activeContractAddress: string }) => (
        <div data-post={postId} data-contract={activeContractAddress} />
    ),
}));

describe('embedded post activity', () => {
    it('renders likes and separate tips using the desktop-selected contract', () => {
        const context = {
            postsRef: { current: {
                'preV12:1': { postId: 'preV12:1', postLevel: 'Post', poster: '0x1111111111111111111111111111111111111111', posterDetails_atTimeOfPost: { state: 'Human' }, isLike: false },
                'preV12:2': { postId: 'preV12:2', postLevel: 'Reply', replyToPostId: 'preV12:1', poster: '0x2222222222222222222222222222222222222222', posterDetails_atTimeOfPost: { state: 'Human' }, isLike: true },
            } },
            activeContractAddress: '0x1111111111111111111111111111111111111111',
            postActivityRef: { current: new Map([
                ['10|preV12:2', { timestamp: 10, postId: 'preV12:2', type: 'reply', read: true }],
                ['11|preV12:1|0xaaa', { timestamp: 11, postId: 'preV12:1', type: 'tip', read: true, tipTxHash: '0xaaa' }],
                ['12|preV12:1|0xbbb', { timestamp: 12, postId: 'preV12:1', type: 'tip', read: true, tipTxHash: '0xbbb' }],
            ]) },
            tipsRef: { current: {
                '0xaaa': { tipper: '0x3333333333333333333333333333333333333333', tipperDetails_atTimeOfTip: { state: 'Human' } },
                '0xbbb': { tipper: '0x4444444444444444444444444444444444444444', tipperDetails_atTimeOfTip: { state: 'Human' } },
            } },
            unreadPostActivityThisVisitRef: { current: new Set() },
            postersRef: { current: {} },
            postersAddress: '0x1111111111111111111111111111111111111111',
        };
        const markup = renderToStaticMarkup(
            <MemoryRouter initialEntries={['/postactivity']}>
                <Routes>
                    <Route element={<Outlet context={context} />}>
                        <Route path="/postactivity" element={<PostActivity />} />
                    </Route>
                </Routes>
            </MemoryRouter>,
        );
        expect(markup.match(/data-contract="0x1111111111111111111111111111111111111111"/g)).toHaveLength(3);
        expect(markup).toContain('received a like');
        expect(markup.match(/received a tip/g)).toHaveLength(2);
    });
});
