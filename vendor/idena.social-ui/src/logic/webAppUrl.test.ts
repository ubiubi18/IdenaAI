import { describe, expect, it } from 'vitest';
import { normalizeWebAppUrl } from './webAppUrl';

describe('Idena Web App URL', () => {
    it('accepts HTTPS and local HTTP, preserving a configured base path', () => {
        expect(normalizeWebAppUrl('https://app.idena.io/')).toBe('https://app.idena.io');
        expect(normalizeWebAppUrl('http://localhost:3000/wallet/')).toBe('http://localhost:3000/wallet');
    });

    it.each([
        'javascript:alert(1)',
        'data:text/html,hello',
        'http://example.com',
        'https://user:pass@example.com',
        'https://example.com/?redirect=evil',
        'https://example.com/#payload',
    ])('rejects an unsafe transaction target: %s', (url) => {
        expect(normalizeWebAppUrl(url)).toBeNull();
    });
});
