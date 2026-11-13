import fs from "fs";
import { ethers } from "ethers";
import { computeElectionKey, GENESIS_HASH } from "../utils/crypto.js";

const artifact = JSON.parse(
    fs.readFileSync(new URL("../web3/BallotsRegistry.json", import.meta.url), "utf8")
);

const EXPLORER_BY_CHAIN = {
    1: "https://etherscan.io",
    11155111: "https://sepolia.etherscan.io",
    137: "https://polygonscan.com",
    80002: "https://amoy.polygonscan.com",
    8453: "https://basescan.org",
    84532: "https://sepolia.basescan.org"
};

const NETWORK_NAME_BY_CHAIN = {
    1: "Ethereum Mainnet",
    11155111: "Ethereum Sepolia",
    137: "Polygon PoS",
    80002: "Polygon Amoy",
    8453: "Base Mainnet",
    84532: "Base Sepolia",
    31337: "Hardhat Local EVM"
};

let relayerQueue = Promise.resolve();
let cachedClient = null;

function withRelayerLock(fn) {
    const run = relayerQueue.then(fn, fn);
    relayerQueue = run.catch(() => {});
    return run;
}

function getConfig() {
    const rpcUrl = process.env.WEB3_RPC_URL?.trim() || "";
    const privateKey = process.env.WEB3_PRIVATE_KEY?.trim() || "";
    const contractAddress = process.env.WEB3_CONTRACT_ADDRESS?.trim() || "";
    const strictMode = process.env.WEB3_STRICT_MODE === "true";
    const allowFallback = process.env.WEB3_ALLOW_OFFCHAIN_FALLBACK === "true";
    const configuredChainId = process.env.WEB3_CHAIN_ID ? Number(process.env.WEB3_CHAIN_ID) : null;
    const networkName = process.env.WEB3_NETWORK_NAME?.trim() || "";
    const explorerBaseUrl = process.env.WEB3_EXPLORER_URL?.trim() || "";

    return {
        rpcUrl,
        privateKey,
        contractAddress,
        strictMode,
        allowFallback,
        configuredChainId,
        networkName,
        explorerBaseUrl,
        configured: Boolean(rpcUrl && privateKey && contractAddress)
    };
}

function getClient() {
    const cfg = getConfig();
    if (!cfg.configured) return null;

    const cacheKey = `${cfg.rpcUrl}|${cfg.privateKey}|${cfg.contractAddress}`;
    if (cachedClient && cachedClient.cacheKey === cacheKey) {
        return cachedClient;
    }

    const networkHint = cfg.configuredChainId ? ethers.Network.from(cfg.configuredChainId) : undefined;
    const provider = new ethers.JsonRpcProvider(cfg.rpcUrl, networkHint, {
        cacheTimeout: -1,
        batchMaxCount: 1,
        ...(networkHint ? { staticNetwork: networkHint } : {})
    });
    const wallet = new ethers.Wallet(cfg.privateKey, provider);
    const contract = new ethers.Contract(cfg.contractAddress, artifact.abi, wallet);

    cachedClient = { cacheKey, provider, wallet, contract, cfg, nextNonce: null };
    return cachedClient;
}

async function sendContractTx(client, methodName, args) {
    for (let attempt = 0; attempt < 2; attempt++) {
        const pendingNonce = await client.provider.getTransactionCount(client.wallet.address, "pending");
        const nonce = client.nextNonce !== null && client.nextNonce > pendingNonce
            ? client.nextNonce
            : pendingNonce;

        try {
            const tx = await client.contract[methodName](...args, { nonce });
            client.nextNonce = nonce + 1;
            const receipt = await tx.wait(1);
            return receipt;
        } catch (err) {
            client.nextNonce = null;
            const msg = String(err?.shortMessage || err?.message || "").toLowerCase();
            if (attempt === 0 && (msg.includes("nonce") || err?.code === "NONCE_EXPIRED")) {
                continue;
            }
            throw err;
        }
    }
}

export function buildTxExplorerUrl(chainId, txHash, customBaseUrl = "") {
    if (!txHash) return "";
    const base = (customBaseUrl || EXPLORER_BY_CHAIN[Number(chainId)] || "").replace(/\/+$/, "");
    if (!base) return "";
    return `${base}/tx/${txHash}`;
}

export function buildContractExplorerUrl(chainId, contractAddress, customBaseUrl = "") {
    if (!contractAddress) return "";
    const base = (customBaseUrl || EXPLORER_BY_CHAIN[Number(chainId)] || "").replace(/\/+$/, "");
    if (!base) return "";
    return `${base}/address/${contractAddress}`;
}

async function resolveNetworkMeta(client) {
    const net = await client.provider.getNetwork();
    const chainId = Number(net.chainId);
    const networkName =
        client.cfg.networkName ||
        NETWORK_NAME_BY_CHAIN[chainId] ||
        `EVM Chain ${chainId}`;
    return { chainId, networkName };
}

export function isWeb3Configured() {
    return getConfig().configured;
}

export function isWeb3StrictMode() {
    return getConfig().strictMode;
}

export async function getWeb3Status() {
    const cfg = getConfig();
    if (!cfg.configured) {
        return {
            configured: false,
            strictMode: cfg.strictMode,
            networkName: cfg.networkName || "No configurada",
            chainId: cfg.configuredChainId,
            contractAddress: cfg.contractAddress || null,
            relayerAddress: null,
            explorerBaseUrl: cfg.explorerBaseUrl || null
        };
    }

    const client = getClient();
    try {
        const { chainId, networkName } = await resolveNetworkMeta(client);
        const explorerBase = cfg.explorerBaseUrl || EXPLORER_BY_CHAIN[chainId] || null;
        return {
            configured: true,
            strictMode: cfg.strictMode,
            networkName,
            chainId,
            contractAddress: cfg.contractAddress,
            relayerAddress: client.wallet.address,
            explorerBaseUrl: explorerBase,
            contractExplorerUrl: buildContractExplorerUrl(chainId, cfg.contractAddress, cfg.explorerBaseUrl)
        };
    } catch (error) {
        return {
            configured: true,
            strictMode: cfg.strictMode,
            networkName: cfg.networkName || "RPC unreachable",
            chainId: cfg.configuredChainId,
            contractAddress: cfg.contractAddress,
            relayerAddress: client.wallet.address,
            error: error.message
        };
    }
}

async function ensureElectionRegisteredInternal(client, {
    electionId,
    padronRoot = GENESIS_HASH,
    openPadron = false,
    startDate,
    endDate
}) {
    const electionKey = computeElectionKey(electionId);
    const existing = await client.contract.getElectionRecord(electionKey);
    if (existing.exists) {
        return {
            alreadyRegistered: true,
            electionKey,
            txHash: null
        };
    }

    const startSec = Math.floor(new Date(startDate || Date.now()).getTime() / 1000);
    const rawEndSec = Math.floor(new Date(endDate || Date.now() + 86400000).getTime() / 1000);
    const endSec = rawEndSec > startSec ? rawEndSec : startSec + 60;

    const receipt = await sendContractTx(client, "registerElection", [
        electionKey,
        padronRoot || GENESIS_HASH,
        Boolean(openPadron),
        BigInt(startSec),
        BigInt(endSec)
    ]);
    return {
        alreadyRegistered: false,
        electionKey,
        txHash: receipt.hash,
        blockNumber: Number(receipt.blockNumber)
    };
}

export async function ensureElectionRegistered(params) {
    const client = getClient();
    if (!client) {
        return { configured: false, registered: false };
    }
    return withRelayerLock(async () => {
        const res = await ensureElectionRegisteredInternal(client, params);
        const { chainId, networkName } = await resolveNetworkMeta(client);
        return {
            configured: true,
            registered: true,
            chainId,
            networkName,
            contractAddress: client.cfg.contractAddress,
            ...res
        };
    });
}

export async function syncPadronRoot({ electionId, padronRoot }) {
    const client = getClient();
    if (!client) {
        return { configured: false, synced: false };
    }

    return withRelayerLock(async () => {
        const electionKey = computeElectionKey(electionId);
        const existing = await client.contract.getElectionRecord(electionKey);
        if (!existing.exists || existing.finalized) {
            return { configured: true, synced: false, reason: "Election not active on-chain" };
        }
        if (!existing.openPadron && existing.voteCount > 0n) {
            return { configured: true, synced: false, reason: "Padron frozen after voting started" };
        }
        if (existing.padronRoot.toLowerCase() === (padronRoot || GENESIS_HASH).toLowerCase()) {
            return { configured: true, synced: true, unchanged: true };
        }
        const receipt = await sendContractTx(client, "updatePadronRoot", [
            electionKey,
            padronRoot || GENESIS_HASH
        ]);
        return {
            configured: true,
            synced: true,
            txHash: receipt.hash,
            blockNumber: Number(receipt.blockNumber)
        };
    });
}

export async function anchorVote({
    electionId,
    nullifierHash,
    ballotCommitment,
    weight = 1,
    padronRoot = GENESIS_HASH,
    openPadron = false,
    startDate,
    endDate
}) {
    const cfg = getConfig();
    const client = getClient();

    if (!client) {
        if (cfg.strictMode) {
            throw new Error("Web3 no está configurado (WEB3_RPC_URL / WEB3_PRIVATE_KEY / WEB3_CONTRACT_ADDRESS requeridos en modo estricto).");
        }
        return {
            anchored: false,
            network: "",
            chainId: null,
            contractAddress: "",
            txHash: "",
            blockNumber: null,
            explorerUrl: "",
            onChainVoteIndex: null,
            error: "WEB3_NOT_CONFIGURED"
        };
    }

    try {
        return await withRelayerLock(async () => {
            const { chainId, networkName } = await resolveNetworkMeta(client);
            await ensureElectionRegisteredInternal(client, {
                electionId,
                padronRoot,
                openPadron,
                startDate,
                endDate
            });

            const electionKey = computeElectionKey(electionId);
            const receipt = await sendContractTx(client, "castVote", [
                electionKey,
                nullifierHash,
                ballotCommitment,
                BigInt(weight)
            ]);

            let onChainVoteIndex = null;
            let onChainPreviousTip = null;
            let onChainNewTip = null;

            for (const log of receipt.logs) {
                try {
                    const parsed = client.contract.interface.parseLog(log);
                    if (parsed && parsed.name === "VoteAnchored") {
                        onChainVoteIndex = Number(parsed.args.voteIndex);
                        onChainPreviousTip = parsed.args.previousTip;
                        onChainNewTip = parsed.args.newTip;
                        break;
                    }
                } catch {
                    // Ignore non-matching logs
                }
            }

            return {
                anchored: true,
                network: networkName,
                chainId,
                contractAddress: cfg.contractAddress,
                txHash: receipt.hash,
                blockNumber: Number(receipt.blockNumber),
                explorerUrl: buildTxExplorerUrl(chainId, receipt.hash, cfg.explorerBaseUrl),
                onChainVoteIndex,
                onChainPreviousTip,
                onChainNewTip,
                error: ""
            };
        });
    } catch (error) {
        const message = error?.shortMessage || error?.reason || error?.message || "Web3 transaction failed";
        if (!cfg.allowFallback) {
            throw new Error(`Error al anclar voto en Blockchain: ${message}`);
        }
        return {
            anchored: false,
            network: cfg.networkName,
            chainId: cfg.configuredChainId,
            contractAddress: cfg.contractAddress,
            txHash: "",
            blockNumber: null,
            explorerUrl: "",
            onChainVoteIndex: null,
            error: message
        };
    }
}

export async function finalizeElectionOnChain({ electionId, tallyRoot, padronRoot, openPadron, startDate, endDate }) {
    const client = getClient();
    if (!client) {
        return { configured: false, finalized: false };
    }

    return withRelayerLock(async () => {
        const { chainId, networkName } = await resolveNetworkMeta(client);
        await ensureElectionRegisteredInternal(client, {
            electionId,
            padronRoot,
            openPadron,
            startDate,
            endDate
        });

        const electionKey = computeElectionKey(electionId);
        const record = await client.contract.getElectionRecord(electionKey);
        if (record.finalized) {
            return {
                configured: true,
                finalized: true,
                alreadyFinalized: true,
                chainId,
                networkName,
                tallyRoot: record.tallyRoot,
                chainTip: record.chainTip
            };
        }

        const receipt = await sendContractTx(client, "finalizeElection", [electionKey, tallyRoot]);
        return {
            configured: true,
            finalized: true,
            alreadyFinalized: false,
            chainId,
            networkName,
            contractAddress: client.cfg.contractAddress,
            txHash: receipt.hash,
            blockNumber: Number(receipt.blockNumber),
            explorerUrl: buildTxExplorerUrl(chainId, receipt.hash, client.cfg.explorerBaseUrl),
            tallyRoot
        };
    });
}

export async function getElectionOnChain(electionId) {
    const cfg = getConfig();
    const client = getClient();
    if (!client) {
        return {
            configured: false,
            registered: false,
            electionKey: computeElectionKey(electionId)
        };
    }

    try {
        const { chainId, networkName } = await resolveNetworkMeta(client);
        const electionKey = computeElectionKey(electionId);
        const record = await client.contract.getElectionRecord(electionKey);

        return {
            configured: true,
            networkName,
            chainId,
            contractAddress: cfg.contractAddress,
            contractExplorerUrl: buildContractExplorerUrl(chainId, cfg.contractAddress, cfg.explorerBaseUrl),
            electionKey,
            registered: Boolean(record.exists),
            finalized: Boolean(record.finalized),
            openPadron: Boolean(record.openPadron),
            startTime: Number(record.startTime),
            endTime: Number(record.endTime),
            voteCount: Number(record.voteCount),
            totalWeight: Number(record.totalWeight),
            padronRoot: record.padronRoot,
            chainTip: record.chainTip,
            tallyRoot: record.tallyRoot
        };
    } catch (error) {
        return {
            configured: true,
            registered: false,
            electionKey: computeElectionKey(electionId),
            error: error.message
        };
    }
}

export async function verifyReceiptOnChain({ electionId, nullifierHash, ballotCommitment }) {
    const client = getClient();
    if (!client) {
        return { configured: false, verified: false };
    }

    const { chainId, networkName } = await resolveNetworkMeta(client);
    const electionKey = computeElectionKey(electionId);
    const [nullifierUsed, commitmentRecorded, voteIndexPlusOne, currentChainTip, finalized] =
        await client.contract.verifyReceipt(electionKey, nullifierHash, ballotCommitment);

    return {
        configured: true,
        networkName,
        chainId,
        contractAddress: client.cfg.contractAddress,
        electionKey,
        nullifierUsed: Boolean(nullifierUsed),
        commitmentRecorded: Boolean(commitmentRecorded),
        voteIndex: commitmentRecorded ? Number(voteIndexPlusOne) - 1 : null,
        currentChainTip,
        finalized: Boolean(finalized),
        verified: Boolean(nullifierUsed && commitmentRecorded)
    };
}

export default {
    isWeb3Configured,
    isWeb3StrictMode,
    getWeb3Status,
    ensureElectionRegistered,
    syncPadronRoot,
    anchorVote,
    finalizeElectionOnChain,
    getElectionOnChain,
    verifyReceiptOnChain,
    buildTxExplorerUrl
};
