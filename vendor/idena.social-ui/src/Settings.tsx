import { useNavigate, useOutletContext } from "react-router";

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
    officialIndexerApiUrl?: string,
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
        officialIndexerApiUrl,
    } = useOutletContext() as SettingsProps;

    const handleGoBack = () => {
        navigate(-1);
    };

    return (<>
        <button className="mb-4 text-[13px] hover:cursor-pointer hover:underline" onClick={handleGoBack}>&lt; Back</button>
        <div className="mb-4 text-[14px]">
            <div className="flex flex-col">
                <div className="flex flex-row mb-2 gap-1">
                    <p className="w-13 flex-none text-right">Rpc url:</p>
                    <input className="flex-1 py-0.5 px-1 outline-1 text-[11px] placeholder:text-gray-500" disabled={inputNodeApplied} value={inputNodeUrl} onChange={e => setInputNodeUrl(e.target.value)} />
                </div>
                <div className="flex flex-row mb-1 gap-1">
                    <p className="w-13 flex-none text-right">Api key:</p>
                    <input className="flex-1 py-0.5 px-1 outline-1 text-[11px] placeholder:text-gray-500" disabled={inputNodeApplied} value={inputNodeKey} onChange={e => setInputNodeKey(e.target.value)} />
                </div>
                {!nodeAvailable && <p className="ml-14 text-[11px] text-red-400">Node Unavailable. Please try again.</p>}
            </div>
            <div className="flex flex-row">
                <button className={`h-7 w-16 ml-14 mt-1 inset-ring inset-ring-white/5 hover:bg-white/20 cursor-pointer ${inputNodeApplied ? 'bg-white/10' : 'bg-white/30'}`} onClick={() => setInputNodeApplied(!inputNodeApplied)}>{inputNodeApplied ? 'Change' : 'Apply!'}</button>
                {!inputNodeApplied && <p className="w-18 ml-1.5 mt-1 text-gray-400 text-[11px]/3.5">Apply changes to take effect</p>}
            </div>
        </div>
        <hr className="mb-3 text-gray-500" />
        <div className="flex flex-col mb-6">
            <p>Make posts with:</p>
            <div className="flex flex-row gap-2">
                <input id="useRpc" type="radio" name="useRpc" value="rpc" checked={inputSendingTxs === 'rpc'} onChange={handleInputSendingTxsToggle} />
                <label htmlFor="useRpc" className="flex-none text-right">RPC</label>
            </div>
            {inputSendingTxs === 'rpc' && viewOnlyNode && <p className="ml-4.5 text-[11px] text-red-400">Your RPC is View-Only. Posting, liking, and tipping are disabled until the node exposes a writable account.</p>}
            {!embeddedDesktopOnchainMode && (
                <div className="flex flex-row gap-2">
                    <input id="notUseRpc" type="radio" name="useRpc" value="idena-app" checked={inputSendingTxs === 'idena-app'} onChange={handleInputSendingTxsToggle} />
                    <label htmlFor="notUseRpc" className="flex-none text-right">Use Idena App</label>
                </div>
            )}
            {!embeddedDesktopOnchainMode && inputSendingTxs === 'idena-app' && (
                <div className="flex flex-col ml-5 text-[14px]">
                    <p className="mb-1">Your Idena Address:</p>
                    <input className="flex-1 mb-1 py-0.5 px-1 outline-1 text-[11px] placeholder:text-gray-500" disabled={inputPostersAddressApplied} value={inputPostersAddress} onChange={e => setInputPostersAddress(e.target.value)} />
                    {postersAddressInvalid && <p className="text-[11px] text-red-400">Invalid address. (Posting, liking, tipping is disabled)</p>}
                    <div className="flex flex-row">
                        <button className={`h-7 w-16 mt-1 inset-ring inset-ring-white/5 hover:bg-white/20 cursor-pointer ${inputPostersAddressApplied ? 'bg-white/10' : 'bg-white/30'}`} onClick={() => setInputPostersAddressApplied(!inputPostersAddressApplied)}>{inputPostersAddressApplied ? 'Change' : 'Apply'}</button>
                        {!inputPostersAddressApplied && <p className="w-18 ml-1.5 mt-1 text-gray-400 text-[11px]/3.5">Apply changes to take effect</p>}
                    </div>
                </div>
            )}
        </div>
        <hr className="mb-3 text-gray-500" />
        <div className="flex flex-col mb-6">
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
                    <p className="text-[11px] text-stone-400">Official fallback reader:</p>
                    <input className="flex-1 mb-1 py-0.5 px-1 outline-1 text-[11px] placeholder:text-gray-500" disabled={true} value={officialIndexerApiUrl || ''} readOnly={true} />
                    <p className="text-[11px] text-stone-400">Read-only fallback for older posts. Posting still uses your node RPC.</p>
                </div>
            )}
            {!embeddedDesktopOnchainMode && inputFindingPastPosts === 'indexer-api' && (
                <div className="flex flex-col ml-5 text-[14px]">
                    <div className="flex flex-row gap-1">
                        <p className="mb-1 w-13 flex-none text-right">Api Url:</p>
                        <input className="flex-1 mb-1 py-0.5 px-1 outline-1 text-[11px] placeholder:text-gray-500" disabled={inputIdenaIndexerApiUrlApplied} value={inputIdenaIndexerApiUrl} onChange={e => setInputIdenaIndexerApiUrl(e.target.value)} />
                    </div>
                    {indexerApiUrlInvalid && <p className="ml-14 text-[11px] text-red-400">Invalid Api Url.</p>}
                    <div className="flex flex-row">
                        <button className={`h-7 w-16 mt-1 inset-ring inset-ring-white/5 hover:bg-white/20 cursor-pointer ${inputIdenaIndexerApiUrlApplied ? 'bg-white/10' : 'bg-white/30'}`} onClick={() => setInputIdenaIndexerApiUrlApplied(!inputIdenaIndexerApiUrlApplied)}>{inputIdenaIndexerApiUrlApplied ? 'Change' : 'Apply'}</button>
                        {!inputIdenaIndexerApiUrlApplied && <p className="w-18 ml-1.5 mt-1 text-gray-400 text-[11px]/3.5">Apply changes to take effect</p>}
                    </div>
                </div>
            )}
        </div>
    </>);
}

export default Settings;
