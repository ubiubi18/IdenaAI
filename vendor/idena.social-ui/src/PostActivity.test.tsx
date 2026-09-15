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
                'preV12:1': { postId: 'preV12:1', postLevel: 'Post', isLike: false },
                'preV12:2': { postId: 'preV12:2', postLevel: 'Reply', replyToPostId: 'preV12:1', isLike: true },
            } },
            activeContractAddress: '0x1111111111111111111111111111111111111111',
            postActivityRef: { current: [
                '10-preV12:2-reply',
                '11-preV12:1|0xaaa-tip',
                '12-preV12:1|0xbbb-tip',
            ] },
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
