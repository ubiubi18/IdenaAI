import {describe, expect, it} from 'vitest';
import type {Post} from './asyncUtils';
import {isRenderableTopLevelPost} from './feedVisibility';

const post = (overrides: Partial<Post> = {}) => ({
    timestamp: 1,
    postId: '1',
    poster: '0x0000000000000000000000000000000000000001',
    posterDetails_atTimeOfPost: {stake: 0, state: 'Human', age: 1},
    channelId: '',
    message: 'Visible post',
    txHash: `0x${'11'.repeat(32)}`,
    replyToPostId: '',
    orphaned: false,
    ...overrides,
}) as Post;

describe('top-level feed visibility', () => {
    it('shows resolved top-level text and media posts', () => {
        expect(isRenderableTopLevelPost(post())).toBe(true);
        expect(isRenderableTopLevelPost(post({message: '', image: 'blob:image'}))).toBe(true);
    });

    it('hides unresolved shells until their content is available', () => {
        expect(isRenderableTopLevelPost(post({message: undefined}))).toBe(false);
    });

    it('never exposes reaction records as standalone feed posts', () => {
        expect(isRenderableTopLevelPost(post({message: '❤️'}))).toBe(false);
    });

    it('hides replies and orphaned records from the top-level feed', () => {
        expect(isRenderableTopLevelPost(post({replyToPostId: 'parent'}))).toBe(false);
        expect(isRenderableTopLevelPost(post({orphaned: true}))).toBe(false);
    });
});
