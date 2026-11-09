import { Link, useLocation } from 'react-router';

type DesktopNavigationProps = {
    messagesReady: boolean;
    unreadPostActivities?: number;
    unreadMessages?: number;
};

const navigationItems = [
    { label: 'Feed', path: '/' },
    { label: 'Post activity', path: '/postactivity' },
    { label: 'Direct messages', path: '/messages' },
    { label: 'Settings', path: '/settings' },
];

const routeIsActive = (pathname: string, path: string) => (
    path === '/'
        ? pathname === '/'
        : path === '/messages'
            ? pathname === path || pathname.startsWith('/conversation/')
            : pathname === path || pathname.startsWith(`${path}/`)
);

function DesktopNavigation({ messagesReady, unreadPostActivities = 0, unreadMessages = 0 }: DesktopNavigationProps) {
    const { pathname } = useLocation();

    return (
        <nav
            aria-label="idena.social sections"
            className="mb-3 flex min-h-11 items-stretch gap-1 border-b border-line"
        >
            {navigationItems.map(({ label, path }) => {
                const active = routeIsActive(pathname, path);
                const badgeCount = path === '/postactivity' ? unreadPostActivities : path === '/messages' ? unreadMessages : 0;

                return (
                    <Link
                        key={path}
                        to={path}
                        aria-label={badgeCount > 0 ? `${label} (${badgeCount} unread)` : label}
                        aria-current={active ? 'page' : undefined}
                        className={`flex min-w-0 items-center gap-2 border-b-2 px-4 py-2 text-[14px] font-semibold ${
                            active
                                ? 'border-accent text-ink'
                                : 'border-transparent text-ink-muted hover:border-stone-500 hover:text-ink'
                        }`}
                    >
                        <span>{label}</span>
                        {badgeCount > 0 && <span aria-hidden="true" className="rounded-full bg-btn-hover px-1.5 text-[11px] font-bold text-btn-ink">{badgeCount > 99 ? '99+' : badgeCount}</span>}
                        {path === '/messages' && messagesReady && (
                            <span className="text-[11px] font-normal text-tip">Ready</span>
                        )}
                    </Link>
                );
            })}
        </nav>
    );
}

export default DesktopNavigation;
