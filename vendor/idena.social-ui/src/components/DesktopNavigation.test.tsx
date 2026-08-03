import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import DesktopNavigation from './DesktopNavigation';

describe('DesktopNavigation', () => {
    it('keeps direct messages discoverable in embedded mode', () => {
        const markup = renderToStaticMarkup(
            <MemoryRouter initialEntries={['/messages']}>
                <DesktopNavigation messagesReady={true} />
            </MemoryRouter>,
        );

        expect(markup).toContain('href="/messages"');
        expect(markup).toContain('Direct messages');
        expect(markup).toContain('aria-current="page"');
        expect(markup).toContain('Ready');
    });

    it('does not mark direct messages active on the feed', () => {
        const markup = renderToStaticMarkup(
            <MemoryRouter initialEntries={['/']}>
                <DesktopNavigation messagesReady={false} />
            </MemoryRouter>,
        );

        expect(markup).toContain('href="/messages"');
        expect(markup.match(/aria-current="page"/g)).toHaveLength(1);
        expect(markup).not.toContain('Ready');
    });
});
