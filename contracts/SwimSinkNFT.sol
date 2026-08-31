// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title  Swim/Sink Society NFT
 * @notice Self-evolving NFT collection for the Swim/Sink memecoin
 *         community on Robinhood Chain. Each NFT starts at phase 1
 *         and can be advanced up to phase 10 by burning $SWIM.
 *
 *  Supply:        222 unique NFTs
 *  Phases:        1-10 (minted at phase 1, max is phase 10)
 *  Burn curve:    20K, 30K, ..., 100K $SWIM per advance
 *  Mint price:    0.01 ETH (sent directly to royalty receiver)
 *  Per-wallet:    2 NFTs max
 *  Royalty:       5% (ERC-2981)
 *
 *  Architecture: SWIM token is set once in the constructor and is
 *  immutable for the lifetime of the contract. No admin functions,
 *  no upgrade hooks — fully decentralized from day one.
 *
 *  Note on tax: SWIM is a TAXED_V3 token on Robinhood. When
 *  transferFrom is called, ~1% is taken as tax. The user must
 *  approve the GROSS burn cost (e.g. 20_000e18) — the tax is
 *  deducted on the way to the burn address. This is the standard
 *  pattern for any taxed-token burn flow.
 */

import { ERC721 } from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import { ERC721Enumerable } from
    "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import { ERC2981 } from "@openzeppelin/contracts/token/common/ERC2981.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @dev Minimal interface for the SWIM token. Standard ERC-20
///      methods (transferFrom, approve, allowance, balanceOf) are
///      sufficient for the phase-advance burn flow.
interface IBurnable {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function approve(address spender, uint256 amount) external returns (bool);
    function allowance(address owner, address spender) external view returns (uint256);
    function balanceOf(address account) external view returns (uint256);
}

contract SwimSinkNFT is
    ERC721,
    ERC721Enumerable,
    ERC2981,
    ReentrancyGuard
{
    // =============================================================
    //                         CONSTANTS
    // =============================================================

    /// @notice Price to mint one NFT, paid in native ETH (Robinhood
    ///         Chain native gas token).
    uint256 public constant MINT_PRICE = 0.01 ether;

    /// @notice Maximum NFTs that can ever be minted.
    uint256 public constant MAX_SUPPLY = 222;

    /// @notice Maximum NFTs one wallet can mint.
    uint256 public constant MAX_PER_WALLET = 2;

    /// @notice NFTs are minted at this phase. The first advance goes to 2.
    uint8 public constant INITIAL_PHASE = 1;

    /// @notice Maximum phase. Once reached, advancePhase reverts.
    uint8 public constant MAX_PHASE = 10;

    /// @notice Base unit of the linear burn curve. Burn cost at phase N
    ///         is (PHASE_DENOM + PHASE_DENOM * N) * 10^18.
    ///         Phase 1 -> 2: 20K. Phase 2 -> 3: 30K. Phase 9 -> 10: 100K.
    uint256 public constant PHASE_DENOM = 10_000;

    /// @notice Royalty in basis points. 500 = 5%.
    uint96 public constant ROYALTY_BPS = 500;

    /// @notice Address that receives both mint ETH and secondary-sale
    ///         royalty. Set once at deployment, immutable.
    address public immutable royaltyReceiver;

    /// @notice SWIM token used for phase-advance burns. Set once at
    ///         deployment, immutable.
    IBurnable public immutable swim;

    /// @notice SWIM/SINK bonding curve (or graduated pool) address.
    ///         Stored for off-chain reference (e.g. block explorers,
    ///         metadata tools) — the contract does not read it on-chain.
    address public immutable pool;

    /// @notice Address that receives burned SWIM tokens. Using a well-
    ///         known burn sink; tokens sent here are unrecoverable.
    address public constant BURN_ADDRESS =
        0x000000000000000000000000000000000000dEaD;

    // =============================================================
    //                          STATE
    // =============================================================

    /// @notice Current phase of each NFT, indexed by tokenId.
    ///         Phase 0 means the NFT has not been minted (revert if read).
    mapping(uint256 tokenId => uint8 phase) private _phases;

    /// @notice Number of NFTs minted per wallet. Used to enforce cap.
    mapping(address owner => uint256 count) public mintedPerWallet;

    /// @notice Next tokenId to assign on mint. Starts at 1.
    uint256 private _nextTokenId = 1;

    // =============================================================
    //                          EVENTS
    // =============================================================

    /// @notice Emitted when a new NFT is minted.
    event Minted(uint256 indexed tokenId, address indexed owner);

    /// @notice Emitted when an NFT's phase is advanced.
    event PhaseAdvanced(
        uint256 indexed tokenId,
        uint8 oldPhase,
        uint8 newPhase
    );

    // =============================================================
    //                         ERRORS
    // =============================================================

    error InvalidAddress();
    error IncorrectPayment(uint256 sent, uint256 required);
    error MaxSupplyReached(uint256 cap);
    error MaxPerWalletReached(uint256 cap);
    error NotTokenOwner(address caller, address owner);
    error MaxPhaseReached(uint8 current);
    error InsufficientAllowance(uint256 required, uint256 actual);
    error BurnTransferFailed();

    // =============================================================
    //                       CONSTRUCTOR
    // =============================================================

    /**
     * @param  _swim             Address of the SWIM token on Robinhood Chain
     *                           (set once, immutable for contract lifetime)
     * @param  _royaltyReceiver  Address that receives mint ETH and
     *                           secondary-sale royalty
     * @param  _pool             SWIM/SINK bonding curve or graduated pool
     *                           address. Stored for off-chain reference
     *                           only — the contract does not read it on
     *                           chain.
     */
    constructor(
        address _swim,
        address _royaltyReceiver,
        address _pool
    ) ERC721("Swim Sink Society", "SWIMSNK") {
        if (
            _swim == address(0) ||
            _royaltyReceiver == address(0) ||
            _pool == address(0)
        ) {
            revert InvalidAddress();
        }
        swim = IBurnable(_swim);
        royaltyReceiver = _royaltyReceiver;
        pool = _pool;
        _setDefaultRoyalty(_royaltyReceiver, ROYALTY_BPS);
    }

    // =============================================================
    //                         MINTING
    // =============================================================

    /**
     * @notice Mint one NFT to the caller. Costs MINT_PRICE (0.01 ETH)
     *         in native ETH. Each wallet can mint up to MAX_PER_WALLET
     *         NFTs.
     * @return tokenId The newly minted NFT's id.
     */
    function mint()
        external
        payable
        nonReentrant
        returns (uint256 tokenId)
    {
        if (msg.value != MINT_PRICE) {
            revert IncorrectPayment(msg.value, MINT_PRICE);
        }
        if (totalSupply() >= MAX_SUPPLY) {
            revert MaxSupplyReached(MAX_SUPPLY);
        }
        if (mintedPerWallet[msg.sender] >= MAX_PER_WALLET) {
            revert MaxPerWalletReached(MAX_PER_WALLET);
        }

        // Effects: state changes first (CEI pattern)
        tokenId = _nextTokenId++;
        mintedPerWallet[msg.sender] += 1;
        _phases[tokenId] = INITIAL_PHASE;

        // Mint NFT to caller
        _safeMint(msg.sender, tokenId);

        // Interaction: send mint ETH to royalty receiver
        (bool ok, ) = royaltyReceiver.call{value: msg.value}("");
        if (!ok) revert BurnTransferFailed();

        emit Minted(tokenId, msg.sender);
    }

    // =============================================================
    //                       PHASE LOGIC
    // =============================================================

    /**
     * @notice Read the current phase of an NFT. Reverts if the NFT does
     *         not exist.
     * @param  tokenId The NFT to query.
     * @return The current phase (1-10).
     */
    function phaseOf(uint256 tokenId) external view returns (uint8) {
        _requireOwned(tokenId);
        return _phases[tokenId];
    }

    /**
     * @notice Read the burn cost (in $SWIM, with 18 decimals) for the
     *         next phase advance of a given NFT. Returns 0 if the NFT
     *         is already at MAX_PHASE.
     */
    function burnCostFor(uint256 tokenId) external view returns (uint256) {
        uint8 currentPhase = _phases[tokenId];
        if (currentPhase >= MAX_PHASE) return 0;
        return _phaseCost(currentPhase);
    }

    /**
     * @notice Advance an NFT to the next phase by burning $SWIM
     *         tokens. Caller must be the owner of the NFT and must have
     *         approved this contract to spend the required amount
     *         (gross, including any transfer tax). Phase is
     *         irreversible.
     * @param  tokenId The NFT to advance.
     */
    function advancePhase(uint256 tokenId) external nonReentrant {
        if (_ownerOf(tokenId) != msg.sender) {
            revert NotTokenOwner(msg.sender, _ownerOf(tokenId));
        }

        uint8 currentPhase = _phases[tokenId];
        if (currentPhase >= MAX_PHASE) {
            revert MaxPhaseReached(currentPhase);
        }

        uint256 cost = _phaseCost(currentPhase);

        // Check allowance before transferFrom to give a clearer error
        uint256 allowed = swim.allowance(msg.sender, address(this));
        if (allowed < cost) {
            revert InsufficientAllowance(cost, allowed);
        }

        // Burn: transferFrom user -> dead address. Tokens are permanently
        // unrecoverable. For TAXED_V3 SWIM, ~1% tax is deducted on the
        // way — caller must approve the gross cost.
        bool ok = swim.transferFrom(msg.sender, BURN_ADDRESS, cost);
        if (!ok) revert BurnTransferFailed();

        // Effect: bump phase
        _phases[tokenId] = currentPhase + 1;

        emit PhaseAdvanced(tokenId, currentPhase, currentPhase + 1);
    }

    /// @dev Burn cost at phase N (before advance). Used by both
    ///      advancePhase and burnCostFor.
    function _phaseCost(uint8 currentPhase) internal pure returns (uint256) {
        // (10_000 + 10_000 * currentPhase) * 10^18
        // At phase 1: 20_000 * 10^18
        // At phase 9: 100_000 * 10^18
        unchecked {
            return (uint256(PHASE_DENOM) + uint256(PHASE_DENOM) * currentPhase) * 10 ** 18;
        }
    }

    // =============================================================
    //                         METADATA
    // =============================================================

    /**
     * @notice Returns the metadata URL for an NFT. Points to the
     *         shared /api/nft/<id> Vercel Edge function, which serves
     *         dynamic ERC-721 metadata with the NFT's current phase
     *         image. The endpoint routes by on-chain ownership so
     *         the URL is shared with B20 Society and any future
     *         collection on the same edge.
     */
    function tokenURI(uint256 tokenId)
        public
        view
        override
        returns (string memory)
    {
        _requireOwned(tokenId);
        return string.concat(
            "https://b20society.com/api/nft/",
            _toString(tokenId)
        );
    }

    // =============================================================
    //                   REQUIRED OVERRIDES
    // =============================================================

    function _update(address to, uint256 tokenId, address auth)
        internal
        override(ERC721, ERC721Enumerable)
        returns (address)
    {
        return super._update(to, tokenId, auth);
    }

    function _increaseBalance(address account, uint128 value)
        internal
        override(ERC721, ERC721Enumerable)
    {
        super._increaseBalance(account, value);
    }

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC721, ERC721Enumerable, ERC2981)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }

    // =============================================================
    //                        UTILITIES
    // =============================================================

    /// @dev Integer to decimal string. Used in tokenURI.
    function _toString(uint256 value) internal pure returns (string memory) {
        unchecked {
            uint256 length = 0;
            uint256 v = value;
            if (v == 0) return "0";

            do {
                length++;
                v /= 10;
            } while (v != 0);

            bytes memory buffer = new bytes(length);
            v = value;
            for (uint256 i = length; i > 0; --i) {
                buffer[i - 1] = bytes1(uint8(48 + (v % 10)));
                v /= 10;
            }
            return string(buffer);
        }
    }

    /// @notice Helper to read the phase without reverting on non-existent
    ///         tokens. Returns 0 for non-existent NFTs (use exists() to
    ///         disambiguate).
    function phaseOfOrZero(uint256 tokenId) external view returns (uint8) {
        if (_ownerOf(tokenId) == address(0)) return 0;
        return _phases[tokenId];
    }

    /// @notice Check if a tokenId exists (has been minted and not burned).
    function exists(uint256 tokenId) external view returns (bool) {
        return _ownerOf(tokenId) != address(0);
    }

    /// @notice Total supply view (helper, duplicates ERC721Enumerable
    ///         for clarity).
    function totalMinted() external view returns (uint256) {
        return totalSupply();
    }
}
