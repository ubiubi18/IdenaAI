import { useEffect, useRef } from "react";
import { useNavigate, useOutletContext } from "react-router";
import PageHeaderComponent from "./components/PageHeaderComponent";
import { clearMessagesCache } from "./logic/messagesStore";
import { clearPostersCache } from "./logic/postersStore";
import { clearPostsCache } from "./logic/postsStore";
import { clearTipsCache } from "./logic/tipsStore";
import { clearIgnoresCache } from "./logic/ignoreStore";
import { clearBlocksCapturedRange } from "./logic/blocksCapturedStore";

type SettingsProps = {
    inputNodeApplied: boolean,
    inputNodeUrl: string,
    setInputNodeUrl: React.Dispatch<React.SetStateAction<string>>,
    nodeAvailable: boolean,
    inputNodeKey: string,
    setInputNodeKey: React.Dispatch<React.SetStateAction<string>>,
    setInputNodeApplied: React.Dispatch<React.SetStateAction<boolean>>,
    inputSendingTxs: string,
    handleInputSendingTxsToggle: (event: React.ChangeEvent<HTMLInputElement, Element>) => void,
    viewOnlyNode: boolean,
    inputPostersAddressApplied: boolean,
    inputPostersAddress: string,
    postersAddress: string,
    setInputPostersAddress: React.Dispatch<React.SetStateAction<string>>,
    postersAddressInvalid: boolean,
    setInputPostersAddressApplied: React.Dispatch<React.SetStateAction<boolean>>,
    inputFindingPastPosts: string,
    handleInputFindingPastPostsToggle: (event: React.ChangeEvent<HTMLInputElement, Element>) => void,
    inputIdenaIndexerApiUrlApplied: boolean,
    inputIdenaIndexerApiUrl: string,
    setInputIdenaIndexerApiUrl: React.Dispatch<React.SetStateAction<string>>,
    indexerApiUrlInvalid: boolean,
    setInputIdenaIndexerApiUrlApplied: React.Dispatch<React.SetStateAction<boolean>>,
    embeddedDesktopOnchainMode?: boolean,
    hostMessageCryptoEnabled?: boolean,
    officialIndexerApiUrl?: string,
    encryptedPrivateKey: string,
    setEncryptedPrivateKey: React.Dispatch<React.SetStateAction<string>>,
    password: string,
    setPassword: React.Dispatch<React.SetStateAction<string>>,
    inputCredentialsApplied: boolean,
    credentialsInvalid: string,
    handleSetInputCredentialsApplied: (newValue: boolean) => Promise<void>,
    restoreDefaultSettings: () => void,
};

function Settings() {
    const navigate = useNavigate();

    const {
        inputNodeApplied,
        inputNodeUrl,
        setInputNodeUrl,
        nodeAvailable,
        inputNodeKey,
        setInputNodeKey,
        setInputNodeApplied,
        inputSendingTxs,
        handleInputSendingTxsToggle,
        viewOnlyNode,
        inputPostersAddressApplied,
        inputPostersAddress,
        postersAddress,
        setInputPostersAddress,
        postersAddressInvalid,
        setInputPostersAddressApplied,
        inputFindingPastPosts,
        handleInputFindingPastPostsToggle,
        inputIdenaIndexerApiUrlApplied,
        inputIdenaIndexerApiUrl,
        setInputIdenaIndexerApiUrl,
        indexerApiUrlInvalid,
        setInputIdenaIndexerApiUrlApplied,
        embeddedDesktopOnchainMode,
        hostMessageCryptoEnabled,
        officialIndexerApiUrl,
        encryptedPrivateKey,
        setEncryptedPrivateKey,
        password,
        setPassword,
        inputCredentialsApplied,
        credentialsInvalid,
        handleSetInputCredentialsApplied,
        restoreDefaultSettings,
    } = useOutletContext() as SettingsProps;

    const initialNodeRef = useRef({url: inputNodeUrl, key: inputNodeKey});

    const applyNodeSettings = (applied: boolean) => {
        setInputNodeApplied(applied);
        if (applied && (inputNodeUrl !== initialNodeRef.current.url || inputNodeKey !== initialNodeRef.current.key)) {
            void clearBlocksCapturedRange().then(() => navigate(0));
        }
    };

    const applyAddressSettings = (applied: boolean) => {
        setInputPostersAddressApplied(applied);
        if (applied && inputPostersAddress.toLowerCase() !== postersAddress.toLowerCase()) {
            setEncryptedPrivateKey('');
            setPassword('');
            void clearBlocksCapturedRange().then(() => navigate(0));
        }
    };

    useEffect(() => {
        handleSetInputCredentialsApplied(true);
    }, []);

    const handleRestoreDefaults = () => {
        if (window.confirm('Restore the default idena.social settings?')) {
            restoreDefaultSettings();
        }
    };

    const handleClearCachedContent = async () => {
        const userConfirmed = window.confirm('Clear cached social content?');

        if (userConfirmed) {
            await Promise.all([
                clearMessagesCache(),
                clearPostersCache(),
                clearPostsCache(),
                clearTipsCache(),
                clearIgnoresCache(),
                clearBlocksCapturedRange(),
            ]);
            window.location.reload();
        }
    };

    return (<>
        <PageHeaderComponent title="Settings" />
        <div className="border-b border-line px-4 py-4 text-[15px]">
            <div className="flex flex-col">
                <div className="flex flex-row mb-2 gap-1">
                    <p className="w-13 flex-none text-right">Rpc url:</p>
                    <input className="flex-1 py-0.5 px-1 outline-1 text-[11px] placeholder:text-ink-muted" disabled={inputNodeApplied} value={inputNodeUrl} onChange={e => setInputNodeUrl(e.target.value)} />
                </div>
                <div className="flex flex-row mb-1 gap-1">
                    <p className="w-13 flex-none text-right">Api key:</p>
                    <input className="flex-1 py-0.5 px-1 outline-1 text-[11px] placeholder:text-ink-muted" disabled={inputNodeApplied} value={inputNodeKey} onChange={e => setInputNodeKey(e.target.value)} />
                </div>
                {!nodeAvailable && <p className="ml-14 text-[11px] text-danger">Node Unavailable. Please try again.</p>}
            </div>
            <div className="flex flex-row">
                <button className={`h-7 w-16 ml-14 mt-1 inset-ring inset-ring-line hover:bg-surface-hover cursor-pointer ${inputNodeApplied ? 'bg-surface' : 'bg-line'}`} aria-label={inputNodeApplied ? 'Change node settings' : 'Apply node settings'} onClick={() => applyNodeSettings(!inputNodeApplied)}>{inputNodeApplied ? 'Change' : 'Apply!'}</button>
                {!inputNodeApplied && <p className="w-18 ml-1.5 mt-1 text-ink-muted text-[11px]/3.5">Apply changes to take effect</p>}
            </div>
        </div>
        <hr className="mb-3 text-ink-muted" />
        <div className="flex flex-col gap-2 border-b border-line px-4 py-4">
            <p>Make posts with:</p>
            <div className="flex flex-row gap-2">
                <input id="useRpc" type="radio" name="useRpc" value="rpc" checked={inputSendingTxs === 'rpc'} onChange={handleInputSendingTxsToggle} />
                <label htmlFor="useRpc" className="flex-none text-right">RPC</label>
            </div>
            {inputSendingTxs === 'rpc' && viewOnlyNode && <p className="ml-4.5 text-[11px] text-danger">Your RPC is View-Only. Posting, liking, and tipping are disabled until the node exposes a writable account.</p>}
            {!embeddedDesktopOnchainMode && (
                <div className="flex flex-row gap-2">
                    <input id="notUseRpc" type="radio" name="useRpc" value="idena-app" checked={inputSendingTxs === 'idena-app'} onChange={handleInputSendingTxsToggle} />
                    <label htmlFor="notUseRpc" className="flex-none text-right">Use Idena App</label>
                </div>
            )}
            {!embeddedDesktopOnchainMode && inputSendingTxs === 'idena-app' && (
                <div className="mb-4 flex flex-col ml-5 text-[14px]">
                    <p className="mb-1">Your Idena Address:</p>
                    <input className="flex-1 mb-1 py-0.5 px-1 outline-1 text-[11px] placeholder:text-ink-muted" disabled={inputPostersAddressApplied} value={inputPostersAddress} onChange={e => setInputPostersAddress(e.target.value)} />
                    {postersAddressInvalid && <p className="text-[11px] text-danger">Invalid address. (Posting, liking, tipping is disabled).</p>}
                    <div className="flex flex-row">
                        <button className={`h-7 w-16 mt-1 inset-ring inset-ring-line hover:bg-surface-hover cursor-pointer ${inputPostersAddressApplied ? 'bg-surface' : 'bg-line'}`} aria-label={inputPostersAddressApplied ? 'Change address' : 'Apply address'} onClick={() => applyAddressSettings(!inputPostersAddressApplied)}>{inputPostersAddressApplied ? 'Change' : 'Apply'}</button>
                        {!inputPostersAddressApplied && <p className="w-18 ml-1.5 mt-1 text-ink-muted text-[11px]/3.5">Apply changes to take effect</p>}
                    </div>
                </div>
            )}
            {hostMessageCryptoEnabled ? (
                <div className="mt-4 flex flex-col ml-5 text-[14px]">
                    <p className="mb-1">Direct-message encryption:</p>
                    <p className="text-[11px] text-ink-muted">The desktop host uses your connected node for bounded message encryption and verified on-chain message decryption. Your identity key never enters this embedded page.</p>
                    {credentialsInvalid
                        ? <p className="mt-1 text-[11px] text-danger">Unavailable: {credentialsInvalid}. Messaging is disabled.</p>
                        : <p className="mt-1 text-[11px] text-tip">Ready. Encrypted direct messages are enabled.</p>}
                </div>
            ) : (
                <div className="mt-4 flex flex-col ml-5 text-[14px]">
                    <p className="mb-1">Messaging credentials:</p>
                    <p className="mb-2 text-[11px] text-ink-muted">Enter these manually only if you want encrypted direct messages. The desktop never exports your node key into this page.</p>
                    <p className="mb-1">Encrypted private key:</p>
                    <input className="flex-1 mb-1 py-0.5 px-1 outline-1 text-[11px] placeholder:text-ink-muted" disabled={inputCredentialsApplied} value={encryptedPrivateKey} onChange={e => setEncryptedPrivateKey(e.target.value)} />
                    <p className="mb-1">Password:</p>
                    <input type="password" className="flex-1 mb-1 py-0.5 px-1 outline-1 text-[11px] placeholder:text-ink-muted" disabled={inputCredentialsApplied} value={password} onChange={e => setPassword(e.target.value)} />
                    <div className="flex flex-row">
                        <button className={`h-7 w-16 mt-1 inset-ring inset-ring-line hover:bg-surface-hover cursor-pointer ${inputCredentialsApplied ? 'bg-surface' : 'bg-line'}`} onClick={() => handleSetInputCredentialsApplied(!inputCredentialsApplied)}>{inputCredentialsApplied ? 'Change' : 'Apply'}</button>
                        {!inputCredentialsApplied && <p className="w-18 ml-1.5 mt-1 text-ink-muted text-[11px]/3.5">Apply changes to take effect</p>}
                    </div>
                    {credentialsInvalid && inputCredentialsApplied && <p className="mt-1 text-[11px] text-danger">Invalid credentials: {credentialsInvalid}. (Messaging is disabled)</p>}
                    <p className="mt-2 text-[12px] text-ink-muted">Credentials stay in memory for this browser session and are never written to browser storage.</p>
                </div>
            )}
        </div>
        <hr className="mb-3 text-ink-muted" />
        <div className="flex flex-col gap-2 border-b border-line px-4 py-4">
            <p>Find posts with:</p>
            <div className="flex flex-row gap-2">
                <input id="findPostsWith" type="radio" name="findPostsWith" value="rpc" checked={inputFindingPastPosts === 'rpc'} onChange={handleInputFindingPastPostsToggle} />
                <label htmlFor="findPostsWith" className="flex-none text-right">RPC</label>
            </div>
            <div className="flex flex-row gap-2">
                <input id="notUseFindPastBlocksWithTxsApi" type="radio" name="findPostsWith" value="indexer-api" checked={inputFindingPastPosts === 'indexer-api'} onChange={handleInputFindingPastPostsToggle} />
                <label htmlFor="notUseFindPastBlocksWithTxsApi" className="flex-none text-right">Use official Idena indexer fallback</label>
            </div>
            {embeddedDesktopOnchainMode && inputFindingPastPosts === 'indexer-api' && (
                <div className="flex flex-col ml-5 text-[14px]">
                    <p className="text-[11px] text-ink-muted">Official fallback reader:</p>
                    <input className="flex-1 mb-1 py-0.5 px-1 outline-1 text-[11px] placeholder:text-ink-muted" disabled={true} value={officialIndexerApiUrl || ''} readOnly={true} />
                    <p className="text-[11px] text-ink-muted">Read-only fallback for older posts. Posting still uses your node RPC.</p>
                </div>
            )}
            {!embeddedDesktopOnchainMode && inputFindingPastPosts === 'indexer-api' && (
                <div className="flex flex-col ml-5 text-[14px]">
                    <div className="flex flex-row gap-1">
                        <p className="mb-1 w-13 flex-none text-right">Api Url:</p>
                        <input className="flex-1 mb-1 py-0.5 px-1 outline-1 text-[11px] placeholder:text-ink-muted" disabled={inputIdenaIndexerApiUrlApplied} value={inputIdenaIndexerApiUrl} onChange={e => setInputIdenaIndexerApiUrl(e.target.value)} />
                    </div>
                    {indexerApiUrlInvalid && <p className="ml-14 text-[11px] text-danger">Invalid Api Url.</p>}
                    <div className="flex flex-row">
                        <button className={`h-7 w-16 mt-1 inset-ring inset-ring-line hover:bg-surface-hover cursor-pointer ${inputIdenaIndexerApiUrlApplied ? 'bg-surface' : 'bg-line'}`} onClick={() => setInputIdenaIndexerApiUrlApplied(!inputIdenaIndexerApiUrlApplied)}>{inputIdenaIndexerApiUrlApplied ? 'Change' : 'Apply'}</button>
                        {!inputIdenaIndexerApiUrlApplied && <p className="w-18 ml-1.5 mt-1 text-ink-muted text-[11px]/3.5">Apply changes to take effect</p>}
                    </div>
                </div>
            )}
        </div>
        <hr className="mb-3 text-ink-muted" />
        <div className="mb-6">
            <button
                className="h-9 w-36 mt-1 inset-ring inset-ring-line hover:bg-surface-hover cursor-pointer bg-surface"
                onClick={handleRestoreDefaults}
            >
                Restore Defaults
            </button>
            <p className="mt-1 text-[11px] text-ink-muted">
                Removes idena.social overrides only. Desktop connection values are restored from the host.
            </p>
            <button
                className="h-9 mt-3 px-3 inset-ring inset-ring-line hover:bg-surface-hover cursor-pointer bg-surface"
                onClick={handleClearCachedContent}
            >
                Clear Cached Content
            </button>
        </div>
    </>);
}

export default Settings;
