import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import solc from "solc";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const contractPath = path.join(rootDir, "contracts", "BallotsRegistry.sol");
const outputPath = path.join(rootDir, "src", "web3", "BallotsRegistry.json");

const source = fs.readFileSync(contractPath, "utf8");

const input = {
    language: "Solidity",
    sources: {
        "BallotsRegistry.sol": { content: source }
    },
    settings: {
        optimizer: {
            enabled: true,
            runs: 200
        },
        outputSelection: {
            "*": {
                "*": ["abi", "evm.bytecode.object"]
            }
        }
    }
};

const output = JSON.parse(solc.compile(JSON.stringify(input)));

if (output.errors) {
    const fatal = output.errors.filter(e => e.severity === "error");
    output.errors.forEach(e => {
        console[e.severity === "error" ? "error" : "warn"](e.formattedMessage);
    });
    if (fatal.length > 0) {
        process.exit(1);
    }
}

const compiled = output.contracts["BallotsRegistry.sol"]["BallotsRegistry"];
const artifact = {
    contractName: "BallotsRegistry",
    compiler: solc.version(),
    abi: compiled.abi,
    bytecode: `0x${compiled.evm.bytecode.object}`
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, JSON.stringify(artifact, null, 2));

console.log(`Compiled BallotsRegistry successfully -> ${outputPath}`);

