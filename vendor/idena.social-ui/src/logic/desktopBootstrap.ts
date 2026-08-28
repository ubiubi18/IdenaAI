export type DesktopBootstrap = {
    embeddedMode?: string;
    nodeUrl?: string;
    indexerApiUrl?: string;
    sendingTxs?: string;
    findingPastPosts?: string;
    proposalMode?: boolean;
    proposalTag?: string;
    proposalPublishingEnabled?: boolean;
    composerPlaceholder?: string;
    composerPrefillText?: string;
    composerHint?: string;
    messageCrypto?: string;
};

export type DesktopMessageCryptoResponse = {
    result?: {
        available?: boolean;
        senderCiphertext?: string;
        recipientCiphertext?: string;
        ciphertextIndexes?: number[];
        plaintext?: string;
        role?: 'sender' | 'recipient' | 'both';
        version?: string;
    };
    error?: {message?: string};
};

declare global {
    interface Window {
        __IDENA_SOCIAL_DESKTOP_BOOTSTRAP__?: DesktopBootstrap;
    }
}

export const DESKTOP_BOOTSTRAP_MESSAGE = 'IDENA_SOCIAL_BOOTSTRAP';
export const DESKTOP_BOOTSTRAP_READY_MESSAGE = 'IDENA_SOCIAL_READY';
export const DESKTOP_CHANNEL_INIT_MESSAGE = 'IDENA_SOCIAL_CHANNEL_INIT';
export const DESKTOP_RPC_REQUEST_MESSAGE = 'IDENA_SOCIAL_RPC_REQUEST';
export const DESKTOP_RPC_RESPONSE_MESSAGE = 'IDENA_SOCIAL_RPC_RESPONSE';
export const DESKTOP_CRYPTO_REQUEST_MESSAGE = 'IDENA_SOCIAL_CRYPTO_REQUEST';
export const DESKTOP_CRYPTO_RESPONSE_MESSAGE = 'IDENA_SOCIAL_CRYPTO_RESPONSE';

let desktopMessagePort: MessagePort | null = null;

export const readDesktopBootstrap = (): DesktopBootstrap => {
    if (typeof window === 'undefined') {
        return {};
    }

    const bootstrap = window.__IDENA_SOCIAL_DESKTOP_BOOTSTRAP__;

    return bootstrap && typeof bootstrap === 'object' ? bootstrap : {};
};

export const isEmbeddedDesktopFrame = () =>
    typeof window !== 'undefined' && window.parent && window.parent !== window;

export const installDesktopBootstrapListener = (
    onBootstrap: (bootstrap: DesktopBootstrap) => void,
) => {
    if (typeof window === 'undefined') {
        return () => {};
    }

    const applyBootstrap = (bootstrap: DesktopBootstrap) => {
        const nextBootstrap =
            bootstrap && typeof bootstrap === 'object' ? bootstrap : {};

        window.__IDENA_SOCIAL_DESKTOP_BOOTSTRAP__ = nextBootstrap;
        onBootstrap(nextBootstrap);
    };

    let connectedPort: MessagePort | null = null;
    let handlePortMessage: ((event: MessageEvent) => void) | null = null;

    const handleMessage = (event: MessageEvent) => {
        if (event.source !== window.parent) {
            return;
        }

        const payload =
            event && event.data && typeof event.data === 'object'
                ? event.data
                : null;

        const port = event.ports && event.ports[0];

        if (
            !payload ||
            payload.type !== DESKTOP_CHANNEL_INIT_MESSAGE ||
            !port
        ) {
            return;
        }

        if (connectedPort && handlePortMessage) {
            connectedPort.removeEventListener('message', handlePortMessage);
            connectedPort.close();
        }

        connectedPort = port;
        desktopMessagePort = port;
        handlePortMessage = (portEvent: MessageEvent) => {
            const portPayload =
                portEvent?.data && typeof portEvent.data === 'object'
                    ? portEvent.data
                    : null;

            if (portPayload?.type === DESKTOP_BOOTSTRAP_MESSAGE) {
                applyBootstrap(portPayload.payload);
            }
        };
        port.addEventListener('message', handlePortMessage);
        port.start();
        port.postMessage({type: DESKTOP_BOOTSTRAP_READY_MESSAGE});
    };

    window.addEventListener('message', handleMessage);

    if (window.parent && window.parent !== window) {
        window.parent.postMessage({type: DESKTOP_BOOTSTRAP_READY_MESSAGE}, '*');
    }

    const existingBootstrap = readDesktopBootstrap();
    if (Object.keys(existingBootstrap).length > 0) {
        onBootstrap(existingBootstrap);
    }

    return () => {
        window.removeEventListener('message', handleMessage);
        if (connectedPort && handlePortMessage) {
            connectedPort.removeEventListener('message', handlePortMessage);
            connectedPort.close();
        }
        if (desktopMessagePort === connectedPort) {
            desktopMessagePort = null;
        }
    };
};

let desktopRpcRequestId = 0;
let desktopCryptoRequestId = 0;

export const createDesktopRpcClient = (
    setNodeAvailable: (next: boolean) => void,
    timeout = 15000,
) =>
    async (method: string, params: any[], skipStateUpdate?: boolean) => {
        const port = desktopMessagePort;

        if (
            typeof window === 'undefined' ||
            !window.parent ||
            window.parent === window ||
            !port
        ) {
            !skipStateUpdate && setNodeAvailable(false);
            return { error: { message: 'desktop_rpc_parent_unavailable' } };
        }

        const requestId = `desktop-rpc-${Date.now()}-${desktopRpcRequestId++}`;

        return new Promise<any>((resolve) => {
            let finished = false;

            const cleanup = () => {
                port.removeEventListener('message', handleMessage);
                window.clearTimeout(timer);
            };

            const finish = (response: any) => {
                if (finished) {
                    return;
                }

                finished = true;
                cleanup();

                if (!skipStateUpdate) {
                    setNodeAvailable(!response?.error);
                }

                resolve(response);
            };

            const handleMessage = (event: MessageEvent) => {
                const payload =
                    event && event.data && typeof event.data === 'object'
                        ? event.data
                        : null;

                if (
                    !payload ||
                    payload.type !== DESKTOP_RPC_RESPONSE_MESSAGE ||
                    payload.payload?.requestId !== requestId
                ) {
                    return;
                }

                finish(payload.payload.response || {});
            };

            const timer = window.setTimeout(() => {
                finish({ error: { message: 'desktop_rpc_timeout' } });
            }, timeout);

            port.addEventListener('message', handleMessage);
            port.postMessage({
                type: DESKTOP_RPC_REQUEST_MESSAGE,
                payload: {
                    requestId,
                    method,
                    params: Array.isArray(params) ? params : [],
                },
            });
        });
    };

export const createDesktopMessageCryptoClient = (timeout = 20000) =>
    async (payload: Record<string, unknown>): Promise<DesktopMessageCryptoResponse> => {
        const port = desktopMessagePort;

        if (
            typeof window === 'undefined' ||
            !window.parent ||
            window.parent === window ||
            !port
        ) {
            return {error: {message: 'desktop_crypto_parent_unavailable'}};
        }

        const requestId = `desktop-crypto-${Date.now()}-${desktopCryptoRequestId++}`;

        return new Promise<DesktopMessageCryptoResponse>((resolve) => {
            let finished = false;

            const cleanup = () => {
                port.removeEventListener('message', handleMessage);
                window.clearTimeout(timer);
            };

            const finish = (response: DesktopMessageCryptoResponse) => {
                if (finished) return;
                finished = true;
                cleanup();
                resolve(response);
            };

            const handleMessage = (event: MessageEvent) => {
                const responsePayload =
                    event?.data && typeof event.data === 'object'
                        ? event.data
                        : null;

                if (
                    responsePayload?.type !== DESKTOP_CRYPTO_RESPONSE_MESSAGE ||
                    responsePayload.payload?.requestId !== requestId
                ) {
                    return;
                }

                finish(responsePayload.payload.response || {});
            };

            const timer = window.setTimeout(() => {
                finish({error: {message: 'desktop_crypto_timeout'}});
            }, timeout);

            port.addEventListener('message', handleMessage);
            port.postMessage({
                type: DESKTOP_CRYPTO_REQUEST_MESSAGE,
                payload: {requestId, ...payload},
            });
        });
    };
