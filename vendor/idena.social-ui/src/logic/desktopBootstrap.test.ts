import {afterEach, describe, expect, it, vi} from 'vitest';
import {
    createDesktopMessageCryptoClient,
    createDesktopRpcClient,
    DESKTOP_BOOTSTRAP_MESSAGE,
    DESKTOP_BOOTSTRAP_READY_MESSAGE,
    DESKTOP_CHANNEL_INIT_MESSAGE,
    DESKTOP_CRYPTO_REQUEST_MESSAGE,
    DESKTOP_CRYPTO_RESPONSE_MESSAGE,
    DESKTOP_RPC_REQUEST_MESSAGE,
    DESKTOP_RPC_RESPONSE_MESSAGE,
    installDesktopBootstrapListener,
} from './desktopBootstrap';

describe('desktop bootstrap channel', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('keeps bootstrap and RPC payloads on the transferred message port', async () => {
        const windowListeners = new Map<string, (event: MessageEvent) => void>();
        const portListeners = new Set<(event: MessageEvent) => void>();
        const parent = {postMessage: vi.fn()};
        const port = {
            addEventListener: vi.fn(
                (_type: string, listener: (event: MessageEvent) => void) => {
                    portListeners.add(listener);
                },
            ),
            close: vi.fn(),
            postMessage: vi.fn(),
            removeEventListener: vi.fn(
                (_type: string, listener: (event: MessageEvent) => void) => {
                    portListeners.delete(listener);
                },
            ),
            start: vi.fn(),
        };
        const fakeWindow = {
            addEventListener: vi.fn(
                (type: string, listener: (event: MessageEvent) => void) => {
                    windowListeners.set(type, listener);
                },
            ),
            clearTimeout,
            parent,
            removeEventListener: vi.fn((type: string) => {
                windowListeners.delete(type);
            }),
            setTimeout,
        };
        vi.stubGlobal('window', fakeWindow);

        const onBootstrap = vi.fn();
        const dispose = installDesktopBootstrapListener(onBootstrap);

        expect(parent.postMessage).toHaveBeenCalledWith(
            {type: DESKTOP_BOOTSTRAP_READY_MESSAGE},
            '*',
        );

        windowListeners.get('message')?.({
            data: {type: DESKTOP_CHANNEL_INIT_MESSAGE},
            ports: [port],
            source: parent,
        } as unknown as MessageEvent);

        expect(port.start).toHaveBeenCalledOnce();
        expect(port.postMessage).toHaveBeenCalledWith({
            type: DESKTOP_BOOTSTRAP_READY_MESSAGE,
        });

        for (const listener of portListeners) {
            listener({
                data: {
                    type: DESKTOP_BOOTSTRAP_MESSAGE,
                    payload: {nodeUrl: 'http://127.0.0.1:9009'},
                },
            } as MessageEvent);
        }
        expect(onBootstrap).toHaveBeenCalledWith({
            nodeUrl: 'http://127.0.0.1:9009',
        });

        const setNodeAvailable = vi.fn();
        const requestPromise = createDesktopRpcClient(setNodeAvailable, 100)(
            'dna_identity',
            [],
        );
        const request = port.postMessage.mock.calls.find(
            ([message]) => message.type === DESKTOP_RPC_REQUEST_MESSAGE,
        )?.[0];
        expect(request).toMatchObject({
            type: DESKTOP_RPC_REQUEST_MESSAGE,
            payload: {method: 'dna_identity', params: []},
        });

        for (const listener of [...portListeners]) {
            listener({
                data: {
                    type: DESKTOP_RPC_RESPONSE_MESSAGE,
                    payload: {
                        requestId: request.payload.requestId,
                        response: {result: {address: '0x01'}},
                    },
                },
            } as MessageEvent);
        }

        await expect(requestPromise).resolves.toEqual({
            result: {address: '0x01'},
        });
        expect(setNodeAvailable).toHaveBeenCalledWith(true);

        const cryptoPromise = createDesktopMessageCryptoClient(100)({
            operation: 'status',
            address: '0x0000000000000000000000000000000000000001',
        });
        const cryptoRequest = port.postMessage.mock.calls.find(
            ([message]) => message.type === DESKTOP_CRYPTO_REQUEST_MESSAGE,
        )?.[0];
        expect(cryptoRequest).toMatchObject({
            type: DESKTOP_CRYPTO_REQUEST_MESSAGE,
            payload: {
                operation: 'status',
                address: '0x0000000000000000000000000000000000000001',
            },
        });

        for (const listener of [...portListeners]) {
            listener({
                data: {
                    type: DESKTOP_CRYPTO_RESPONSE_MESSAGE,
                    payload: {
                        requestId: cryptoRequest.payload.requestId,
                        response: {
                            result: {available: true, version: 'host-v1'},
                        },
                    },
                },
            } as MessageEvent);
        }

        await expect(cryptoPromise).resolves.toEqual({
            result: {available: true, version: 'host-v1'},
        });

        dispose();
        expect(port.close).toHaveBeenCalledOnce();
    });
});
