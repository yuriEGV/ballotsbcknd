import "dotenv/config";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { ethers } from "ethers";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const artifactPath = path.resolve(__dirname, "..", "src", "web3", "BallotsRegistry.json");

async function main() {
    const rpcUrl = process.env.WEB3_RPC_URL;
    const privateKey = process.env.WEB3_PRIVATE_KEY;

    if (!rpcUrl || !privateKey) {
        console.error("Missing WEB3_RPC_URL or WEB3_PRIVATE_KEY in environment.");
        process.exit(1);
    }

    if (!fs.existsSync(artifactPath)) {
        console.error("Contract artifact not found. Run `npm run contract:compile` first.");
        process.exit(1);
    }

    const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const wallet = new ethers.Wallet(privateKey, provider);
    const network = await provider.getNetwork();
    const balance = await provider.getBalance(wallet.address);

    console.log(`Deploying BallotsRegistry...`);
    console.log(`Network chainId: ${network.chainId.toString()}`);
    console.log(`Deployer/Relayer address: ${wallet.address}`);
    console.log(`Balance: ${ethers.formatEther(balance)} native tokens`);

    if (balance === 0n) {
        console.error("Deployer wallet has 0 balance. Fund it with testnet/mainnet gas tokens first.");
        process.exit(1);
    }

    const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, wallet);
    const contract = await factory.deploy();
    console.log(`Deploy tx submitted: ${contract.deploymentTransaction().hash}`);

    await contract.waitForDeployment();
    const address = await contract.getAddress();

    console.log(`BallotsRegistry deployed at: ${address}`);
    console.log(`Add to .env / Vercel env vars:`);
    console.log(`WEB3_CONTRACT_ADDRESS=${address}`);
    console.log(`WEB3_CHAIN_ID=${network.chainId.toString()}`);
}

main().catch((err) => {
    console.error("Deployment failed:", err);
    process.exit(1);
});

