// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title BallotsRegistry
 * @notice Privacy-preserving, tamper-evident on-chain voting registry for Ballots Einsoft.
 * @dev Zero PII and zero plaintext candidate choices are ever written on-chain.
 *      Only cryptographic hashes (electionKey, nullifier, ballotCommitment, Merkle roots)
 *      and sequential rolling chain tips are stored.
 */
contract BallotsRegistry {
    struct ElectionRecord {
        bool exists;
        bool finalized;
        bool openPadron;
        uint64 startTime;
        uint64 endTime;
        uint256 voteCount;
        uint256 totalWeight;
        bytes32 padronRoot;
        bytes32 chainTip;
        bytes32 tallyRoot;
    }

    address public owner;
    mapping(address => bool) public relayers;
    mapping(bytes32 => ElectionRecord) private elections;
    mapping(bytes32 => mapping(bytes32 => bool)) public usedNullifiers;
    mapping(bytes32 => mapping(bytes32 => uint256)) public commitmentVoteIndex;

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event RelayerUpdated(address indexed relayer, bool indexed authorized);
    event ElectionRegistered(
        bytes32 indexed electionKey,
        bytes32 padronRoot,
        bool openPadron,
        uint64 startTime,
        uint64 endTime,
        uint256 timestamp
    );
    event PadronRootUpdated(bytes32 indexed electionKey, bytes32 padronRoot, uint256 timestamp);
    event VoteAnchored(
        bytes32 indexed electionKey,
        uint256 indexed voteIndex,
        bytes32 indexed nullifier,
        bytes32 ballotCommitment,
        bytes32 previousTip,
        bytes32 newTip,
        uint256 weight,
        uint256 timestamp
    );
    event ElectionFinalized(
        bytes32 indexed electionKey,
        uint256 voteCount,
        uint256 totalWeight,
        bytes32 finalChainTip,
        bytes32 tallyRoot,
        uint256 timestamp
    );

    modifier onlyOwner() {
        require(msg.sender == owner, "BallotsRegistry: caller is not owner");
        _;
    }

    modifier onlyRelayer() {
        require(relayers[msg.sender] || msg.sender == owner, "BallotsRegistry: caller is not relayer");
        _;
    }

    constructor() {
        owner = msg.sender;
        relayers[msg.sender] = true;
        emit OwnershipTransferred(address(0), msg.sender);
        emit RelayerUpdated(msg.sender, true);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "BallotsRegistry: zero address");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    function setRelayer(address relayer, bool authorized) external onlyOwner {
        require(relayer != address(0), "BallotsRegistry: zero address");
        relayers[relayer] = authorized;
        emit RelayerUpdated(relayer, authorized);
    }

    function registerElection(
        bytes32 electionKey,
        bytes32 padronRoot,
        bool openPadron,
        uint64 startTime,
        uint64 endTime
    ) external onlyRelayer {
        require(electionKey != bytes32(0), "BallotsRegistry: invalid electionKey");
        require(endTime > startTime, "BallotsRegistry: invalid election window");

        ElectionRecord storage e = elections[electionKey];
        require(!e.exists, "BallotsRegistry: election already registered");

        e.exists = true;
        e.openPadron = openPadron;
        e.startTime = startTime;
        e.endTime = endTime;
        e.padronRoot = padronRoot;

        emit ElectionRegistered(electionKey, padronRoot, openPadron, startTime, endTime, block.timestamp);
    }

    function updatePadronRoot(bytes32 electionKey, bytes32 padronRoot) external onlyRelayer {
        ElectionRecord storage e = elections[electionKey];
        require(e.exists && !e.finalized, "BallotsRegistry: election not active");
        require(e.openPadron || e.voteCount == 0, "BallotsRegistry: padron frozen after voting starts");

        e.padronRoot = padronRoot;
        emit PadronRootUpdated(electionKey, padronRoot, block.timestamp);
    }

    function castVote(
        bytes32 electionKey,
        bytes32 nullifier,
        bytes32 ballotCommitment,
        uint256 weight
    ) external onlyRelayer {
        ElectionRecord storage e = elections[electionKey];
        require(e.exists, "BallotsRegistry: election not registered");
        require(!e.finalized, "BallotsRegistry: election already finalized");
        require(nullifier != bytes32(0), "BallotsRegistry: invalid nullifier");
        require(ballotCommitment != bytes32(0), "BallotsRegistry: invalid commitment");
        require(weight > 0, "BallotsRegistry: weight must be positive");
        require(!usedNullifiers[electionKey][nullifier], "BallotsRegistry: duplicate vote rejected");
        require(commitmentVoteIndex[electionKey][ballotCommitment] == 0, "BallotsRegistry: duplicate commitment");

        usedNullifiers[electionKey][nullifier] = true;

        uint256 voteIndex = e.voteCount;
        commitmentVoteIndex[electionKey][ballotCommitment] = voteIndex + 1;

        bytes32 previousTip = e.chainTip;
        bytes32 newTip = keccak256(abi.encodePacked(previousTip, nullifier, ballotCommitment, weight));

        e.chainTip = newTip;
        e.voteCount = voteIndex + 1;
        e.totalWeight += weight;

        emit VoteAnchored(
            electionKey,
            voteIndex,
            nullifier,
            ballotCommitment,
            previousTip,
            newTip,
            weight,
            block.timestamp
        );
    }

    function finalizeElection(bytes32 electionKey, bytes32 tallyRoot) external onlyRelayer {
        ElectionRecord storage e = elections[electionKey];
        require(e.exists, "BallotsRegistry: election not registered");
        require(!e.finalized, "BallotsRegistry: election already finalized");
        require(tallyRoot != bytes32(0), "BallotsRegistry: invalid tallyRoot");

        e.finalized = true;
        e.tallyRoot = tallyRoot;

        emit ElectionFinalized(electionKey, e.voteCount, e.totalWeight, e.chainTip, tallyRoot, block.timestamp);
    }

    function verifyReceipt(
        bytes32 electionKey,
        bytes32 nullifier,
        bytes32 ballotCommitment
    )
        external
        view
        returns (
            bool nullifierUsed,
            bool commitmentRecorded,
            uint256 voteIndexPlusOne,
            bytes32 currentChainTip,
            bool finalized
        )
    {
        ElectionRecord storage e = elections[electionKey];
        return (
            usedNullifiers[electionKey][nullifier],
            commitmentVoteIndex[electionKey][ballotCommitment] > 0,
            commitmentVoteIndex[electionKey][ballotCommitment],
            e.chainTip,
            e.finalized
        );
    }

    function getElectionRecord(bytes32 electionKey) external view returns (ElectionRecord memory) {
        return elections[electionKey];
    }
}

