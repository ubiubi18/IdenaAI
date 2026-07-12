import {describe, expect, it} from 'vitest';
import {getMessageLines} from './utils';

describe('getMessageLines', () => {
    it('limits LF-only and CRLF messages to the same bounded line count', () => {
        const lines = Array.from({length: 35}, (_, index) => `line-${index}`);

        expect(getMessageLines(lines.join('\n')).messageLines).toEqual(
            lines.slice(0, 30),
        );
        expect(getMessageLines(lines.join('\r\n')).messageLines).toEqual(
            lines.slice(0, 30),
        );
    });

    it('returns one empty line for missing content', () => {
        expect(getMessageLines()).toEqual({messageLines: ['']});
    });
});
