import { Link, useLocation } from 'react-router';

type DesktopNavigationProps = {
    messagesReady: boolean;
};

const navigationItems = [
    { label: 'Feed', path: '/' },
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

function DesktopNavigation({ messagesReady }: DesktopNavigationProps) {
    const { pathname } = useLocation();

    return (
        <nav
            aria-label="idena.social sections"
            className="mb-3 flex min-h-11 items-stretch gap-1 border-b border-stone-700"
        >
            {navigationItems.map(({ label, path }) => {
                const active = routeIsActive(pathname, path);

                return (
                    <Link
                        key={path}
                        to={path}
                        aria-current={active ? 'page' : undefined}
                        className={`flex min-w-0 items-center gap-2 border-b-2 px-4 py-2 text-[14px] font-semibold ${
                            active
                                ? 'border-blue-400 text-white'
                                : 'border-transparent text-stone-300 hover:border-stone-500 hover:text-white'
                        }`}
                    >
                        <span>{label}</span>
                        {path === '/messages' && messagesReady && (
                            <span className="text-[11px] font-normal text-green-400">Ready</span>
                        )}
                    </Link>
                );
            })}
        </nav>
    );
}

export default DesktopNavigation;
