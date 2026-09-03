// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ERC165} from "@openzeppelin/contracts/utils/introspection/ERC165.sol";
import {IERC1271} from "@openzeppelin/contracts/interfaces/IERC1271.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {IERC6551Account} from "./interfaces/IERC6551Account.sol";
import {IERC6551Executable} from "./interfaces/IERC6551Executable.sol";
import {IHeirAccount} from "./interfaces/IHeirAccount.sol";
import {ISoulbindable} from "./interfaces/ISoulbindable.sol";

/// @title HeirAccount
/// @notice 6551-shaped account with check-in, execute-while-alive, and claim that
///         sweeps ETH + an initialize-time ERC-20 allowlist (Option A).
/// @dev After the first claim the estate NFT is soulbound (must succeed).
///      Execute is dead once isClaimable(). Chip holders are not beneficiaries.
///      Not a complete ERC-6551 account: token() is storage, not bytecode extra data.
contract HeirAccount is IERC6551Account, IERC6551Executable, IHeirAccount, IERC1271, ERC165, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes4 private constant MAGIC = IERC6551Account.isValidSigner.selector;
    bytes4 private constant ERC1271_MAGIC = IERC1271.isValidSignature.selector;
    uint16 public constant BPS = 10_000;
    uint256 public constant MAX_ALLOWED_TOKENS = 8;
    uint64 public constant MIN_INACTIVITY = 30 days;
    uint64 public constant MIN_GRACE = 7 days;

    address public immutable factory;

    bool private _initialized;
    uint256 private _state;
    uint256 private _chainId;
    address private _tokenContract;
    uint256 private _tokenId;

    Rules private _rules;
    uint64 private _lastActive;
    uint256 private _ethClaimBase;
    bool private _claimBaseCaptured;
    uint256 private _claimedCount;
    address public lastClaimant;

    Beneficiary[] private _beneficiaries;
    address[] private _allowedTokens;
    mapping(address => uint256) private _tokenClaimBase;
    mapping(address => bool) private _claimed;
    mapping(address => uint256) private _ethOwed;

    event Initialized(address indexed tokenContract, uint256 indexed tokenId);
    event CheckIn(uint64 timestamp);
    event BeneficiariesSet(uint256 count);
    event Claimed(address indexed beneficiary, uint256 ethAmount);
    event ClaimedToken(address indexed beneficiary, address indexed token, uint256 amount);
    event Soulbound(uint256 indexed tokenId);
    event DustSkimmed(address indexed to, uint256 ethAmount);

    error AlreadyInitialized();
    error NotFactory();
    error InvalidRules();
    error InvalidShares();
    error InvalidAllowlist();
    error DuplicateBeneficiary();
    error NotSigner();
    error NotClaimable();
    error AlreadyClaimed();
    error NotBeneficiary();
    error CallFailed();
    error OnlyCall();
    error NothingOwed();
    error StillOpen();

    modifier onlyInit() {
        if (_initialized) revert AlreadyInitialized();
        _;
    }

    /// @param factory_ OfficeFactory that may call initialize.
    /// @param lockImplementation_ true for the shared implementation (cannot initialize).
    constructor(address factory_, bool lockImplementation_) {
        factory = factory_;
        if (lockImplementation_) _initialized = true;
    }

    receive() external payable {}

    function initialize(
        address tokenContract,
        uint256 tokenId,
        Rules calldata rules_,
        Beneficiary[] calldata beneficiaries_,
        address[] calldata allowedTokens_
    ) external onlyInit {
        if (msg.sender != factory) revert NotFactory();
        if (tokenContract == address(0)) revert InvalidRules();
        if (rules_.inactivityPeriod < MIN_INACTIVITY) revert InvalidRules();
        if (rules_.gracePeriod < MIN_GRACE) revert InvalidRules();
        if (rules_.oracleEnabled) revert InvalidRules();

        _writeBeneficiaries(beneficiaries_);

        uint256 t = allowedTokens_.length;
        if (t > MAX_ALLOWED_TOKENS) revert InvalidAllowlist();
        for (uint256 i; i < t;) {
            address allowed = allowedTokens_[i];
            if (allowed == address(0)) revert InvalidAllowlist();
            for (uint256 j; j < i;) {
                if (_allowedTokens[j] == allowed) revert InvalidAllowlist();
                unchecked {
                    ++j;
                }
            }
            _allowedTokens.push(allowed);
            unchecked {
                ++i;
            }
        }

        _initialized = true;
        _chainId = block.chainid;
        _tokenContract = tokenContract;
        _tokenId = tokenId;
        _rules = rules_;
        _lastActive = uint64(block.timestamp);

        emit Initialized(tokenContract, tokenId);
    }

    function setBeneficiaries(Beneficiary[] calldata next) external nonReentrant {
        if (!_isOwner(msg.sender) || isClaimable() || _claimBaseCaptured) revert NotSigner();
        _writeBeneficiaries(next);
        _lastActive = uint64(block.timestamp);
        ++_state;
        emit BeneficiariesSet(next.length);
    }

    function token()
        external
        view
        returns (uint256 chainId, address tokenContract, uint256 tokenId)
    {
        return (_chainId, _tokenContract, _tokenId);
    }

    function state() external view returns (uint256) {
        return _state;
    }

    function isValidSigner(address signer, bytes calldata) external view returns (bytes4) {
        return _isOwner(signer) && !isClaimable() ? MAGIC : bytes4(0);
    }

    function isValidSignature(bytes32 hash, bytes calldata signature) external view returns (bytes4) {
        (address signer, ECDSA.RecoverError err,) = ECDSA.tryRecover(hash, signature);
        if (err != ECDSA.RecoverError.NoError) return bytes4(0xffffffff);
        return _isOwner(signer) && !isClaimable() ? ERC1271_MAGIC : bytes4(0xffffffff);
    }

    function supportsInterface(bytes4 interfaceId) public view virtual override returns (bool) {
        return interfaceId == type(IERC6551Account).interfaceId
            || interfaceId == type(IERC6551Executable).interfaceId
            || interfaceId == type(IERC1271).interfaceId
            || super.supportsInterface(interfaceId);
    }

    function execute(address to, uint256 value, bytes calldata data, uint8 operation)
        external
        payable
        nonReentrant
        returns (bytes memory)
    {
        if (!_isOwner(msg.sender) || isClaimable()) revert NotSigner();
        if (operation != 0) revert OnlyCall();
        ++_state;
        (bool ok, bytes memory result) = to.call{value: value}(data);
        if (!ok) revert CallFailed();
        return result;
    }

    function checkIn() external nonReentrant {
        if (!_isOwner(msg.sender) || isClaimable()) revert NotSigner();
        _lastActive = uint64(block.timestamp);
        ++_state;
        emit CheckIn(_lastActive);
    }

    function lastActive() external view returns (uint64) {
        return _lastActive;
    }

    function isClaimable() public view returns (bool) {
        return block.timestamp >=
            uint256(_lastActive) + uint256(_rules.inactivityPeriod) + uint256(_rules.gracePeriod);
    }

    function rules() external view returns (Rules memory) {
        return _rules;
    }

    function beneficiaryCount() external view returns (uint256) {
        return _beneficiaries.length;
    }

    function beneficiaryAt(uint256 index) external view returns (Beneficiary memory) {
        return _beneficiaries[index];
    }

    function allowedTokenCount() external view returns (uint256) {
        return _allowedTokens.length;
    }

    function allowedTokenAt(uint256 index) external view returns (address) {
        return _allowedTokens[index];
    }

    function ethOwed(address wallet) external view returns (uint256) {
        return _ethOwed[wallet];
    }

    function claim() external nonReentrant {
        if (!isClaimable()) revert NotClaimable();
        uint16 share = _shareOf(msg.sender);
        if (share == 0) revert NotBeneficiary();
        if (_claimed[msg.sender]) revert AlreadyClaimed();

        if (!_claimBaseCaptured) {
            _ethClaimBase = address(this).balance;
            uint256 t = _allowedTokens.length;
            for (uint256 i; i < t;) {
                address token_ = _allowedTokens[i];
                _tokenClaimBase[token_] = IERC20(token_).balanceOf(address(this));
                unchecked {
                    ++i;
                }
            }
            _claimBaseCaptured = true;
            _trySoulbind();
        }

        _claimed[msg.sender] = true;
        ++_claimedCount;
        lastClaimant = msg.sender;
        ++_state;

        uint256 ethAmount = (_ethClaimBase * share) / BPS;
        if (ethAmount > 0) {
            (bool ok,) = msg.sender.call{value: ethAmount}("");
            if (!ok) _ethOwed[msg.sender] += ethAmount;
        }
        emit Claimed(msg.sender, ethAmount);

        uint256 tn = _allowedTokens.length;
        for (uint256 i; i < tn;) {
            address token_ = _allowedTokens[i];
            uint256 amount = (_tokenClaimBase[token_] * share) / BPS;
            if (amount != 0) {
                IERC20(token_).safeTransfer(msg.sender, amount);
                emit ClaimedToken(msg.sender, token_, amount);
            }
            unchecked {
                ++i;
            }
        }
    }

    function withdrawETH() external nonReentrant {
        uint256 amount = _ethOwed[msg.sender];
        if (amount == 0) revert NothingOwed();
        _ethOwed[msg.sender] = 0;
        (bool ok,) = msg.sender.call{value: amount}("");
        if (!ok) revert CallFailed();
    }

    function skimDust() external nonReentrant {
        if (!_claimBaseCaptured || _claimedCount != _beneficiaries.length) revert StillOpen();
        address to = lastClaimant;
        if (to == address(0)) revert NotBeneficiary();
        uint256 ethBal = address(this).balance;
        if (ethBal > 0) {
            (bool ok,) = to.call{value: ethBal}("");
            if (!ok) revert CallFailed();
        }
        uint256 t = _allowedTokens.length;
        for (uint256 i; i < t;) {
            address token_ = _allowedTokens[i];
            uint256 bal = IERC20(token_).balanceOf(address(this));
            if (bal > 0) IERC20(token_).safeTransfer(to, bal);
            unchecked {
                ++i;
            }
        }
        emit DustSkimmed(to, ethBal);
    }

    function _writeBeneficiaries(Beneficiary[] calldata list) internal {
        uint256 n = list.length;
        if (n == 0 || n > 20) revert InvalidShares();
        delete _beneficiaries;
        uint256 total;
        for (uint256 i; i < n;) {
            address w = list[i].wallet;
            if (w == address(0) || list[i].shareBps == 0) revert InvalidShares();
            for (uint256 j; j < i;) {
                if (_beneficiaries[j].wallet == w) revert DuplicateBeneficiary();
                unchecked {
                    ++j;
                }
            }
            total += list[i].shareBps;
            _beneficiaries.push(list[i]);
            unchecked {
                ++i;
            }
        }
        if (total != BPS) revert InvalidShares();
    }

    function _trySoulbind() internal {
        ISoulbindable(_tokenContract).soulbind(_tokenId);
        emit Soulbound(_tokenId);
    }

    function _shareOf(address wallet) internal view returns (uint16) {
        uint256 n = _beneficiaries.length;
        for (uint256 i; i < n;) {
            if (_beneficiaries[i].wallet == wallet) return _beneficiaries[i].shareBps;
            unchecked {
                ++i;
            }
        }
        return 0;
    }

    function _isOwner(address signer) internal view returns (bool) {
        if (_tokenContract == address(0)) return false;
        try IERC721(_tokenContract).ownerOf(_tokenId) returns (address owner) {
            return owner == signer;
        } catch {
            return false;
        }
    }
}
