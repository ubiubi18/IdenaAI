// The entry point applies the theme after the CSP-protected module loads.

export type Theme = 'light' | 'dark' | 'system';

export const defaultTheme: Theme = 'light';

const darkSchemeQuery = typeof window === 'undefined' ? undefined : window.matchMedia?.('(prefers-color-scheme: dark)');

export const getTheme = (): Theme => {
    try {
        const theme = localStorage.getItem('theme');
        return theme === 'dark' || theme === 'system' ? theme : defaultTheme;
    } catch {
        return defaultTheme;
    }
};

export const applyTheme = (theme: Theme) => {
    const root = document.documentElement;
    root.classList.toggle('dark', theme === 'dark' || (theme === 'system' && !!darkSchemeQuery?.matches));
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', getComputedStyle(root).getPropertyValue('--color-canvas').trim());
};

export const saveTheme = (theme: Theme) => {
    try {
        localStorage.setItem('theme', theme);
    } catch {
        // The desktop iframe can run without browser storage.
    }
    applyTheme(theme);
};

export const initTheme = () => {
    applyTheme(getTheme());
    darkSchemeQuery?.addEventListener('change', () => getTheme() === 'system' && applyTheme('system'));
};
