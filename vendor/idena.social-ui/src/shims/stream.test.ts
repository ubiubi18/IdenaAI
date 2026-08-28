import { describe, expect, it } from 'vitest';
import isSvg from 'is-svg';

describe('browser SVG parser compatibility', () => {
    it('accepts valid SVG documents without a Node stream implementation', () => {
        expect(isSvg('<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0" /></svg>')).toBe(true);
    });

    it('rejects malformed and non-SVG documents', () => {
        expect(isSvg('<svg>')).toBe(false);
        expect(isSvg('<html><svg></svg></html>')).toBe(false);
        expect(isSvg('not an image')).toBe(false);
    });
});
