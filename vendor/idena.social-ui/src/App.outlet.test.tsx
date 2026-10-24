import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes, useOutletContext } from 'react-router';
import { afterAll, describe, expect, it, vi } from 'vitest';
import type { RefObject } from 'react';
import type { PostTips } from './logic/asyncUtils';

vi.mock('react-modal', () => ({
    default: Object.assign(() => null, { setAppElement: () => {} }),
}));

const storage = { getItem: () => null, removeItem: () => {}, setItem: () => {} };
vi.stubGlobal('window', {
    location: { href: 'http://localhost/' },
    localStorage: storage,
    sessionStorage: storage,
});
const savedConsole = { log: console.log, warn: console.warn, error: console.error };
const { default: App } = await import('./App');
Object.assign(console, savedConsole);
afterAll(() => vi.unstubAllGlobals());

function PostTipsConsumer() {
    const { postTipsRef } = useOutletContext<{
        postTipsRef: RefObject<Record<string, PostTips>>;
    }>();
    // Feed and post routes read this shared ref as soon as a post arrives.
    const tips = postTipsRef.current['new-post'] ?? { totalAmount: 0, tips: [] };
    return <p>Post tips: {tips.totalAmount}</p>;
}

describe('social app route context', () => {
    it('provides post tip state to feed and post routes on first render', () => {
        const markup = renderToStaticMarkup(
            <MemoryRouter>
                <Routes>
                    <Route element={<App />}>
                        <Route index element={<PostTipsConsumer />} />
                    </Route>
                </Routes>
            </MemoryRouter>,
        );
        expect(markup).toContain('Post tips: 0');
    });
});
