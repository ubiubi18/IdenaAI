import type {Post} from './asyncUtils';

export const LIKE_REACTION_MESSAGE = '❤️';

export function isRenderableTopLevelPost(post?: Post): boolean {
    if (!post || post.orphaned || post.replyToPostId) {
        return false;
    }

    if (post.message === LIKE_REACTION_MESSAGE) {
        return false;
    }

    return Boolean(String(post.message || '').trim() || post.image || post.video);
}
