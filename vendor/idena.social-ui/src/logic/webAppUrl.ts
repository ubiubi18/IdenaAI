export const defaultWebAppUrl = 'https://app.idena.io';

export function normalizeWebAppUrl(value: string): string | null {
    try {
        const url = new URL(value.trim());
        const loopbackHttp = url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname);
        if ((url.protocol !== 'https:' && !loopbackHttp) || url.username || url.password || url.search || url.hash) return null;
        return `${url.origin}${url.pathname}`.replace(/\/+$/, '');
    } catch {
        return null;
    }
}
