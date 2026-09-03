// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {FamilyShare} from "./FamilyShare.sol";
import {FamilyShareBook} from "./FamilyShareBook.sol";
import {FamilyLaunchCurve} from "./FamilyLaunchCurve.sol";
import {IOfficeHouse} from "./interfaces/IOfficeHouse.sol";
import {IHeirAccount} from "./interfaces/IHeirAccount.sol";

/// @notice Per-family letter + named seats + tradable shares that receive stock.
/// @dev Seats vote. Shares get the drop. Selling a share does not sell a seat.
contract OfficeHouse is IOfficeHouse, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint16 public constant BPS = 10_000;
    uint256 public constant MAG = 1e18;
    uint256 public constant MAX_SEATS = 20;
    uint256 public constant MAX_MANDATE = 8;
    uint64 public constant MIN_VOTING = 3 days;

    enum Kind {
        Mandate,
        Payee
    }

    struct Proposal {
        Kind kind;
        address[] tokens;
        uint16[] weights;
        uint64 deadline;
        uint32 yes;
        uint32 no;
        bool executed;
        address proposer;
    }

    IERC721 public immutable certificate;
    uint256 public immutable tokenId;
    address public immutable pot;
    IERC20 public immutable stock;
    IERC20 public immutable cash;
    address public immutable opener;
    address public immutable platform;
    uint16 public immutable platformBps;
    uint256 public immutable maxSupply;
    FamilyShare public share;
    FamilyShareBook public book;
    FamilyLaunchCurve public curve;
    uint64 public immutable votingPeriod;

    address[] private _seats;
    mapping(address => bool) public isSeat;
    address public lastHead;

    uint16 public potBps;
    uint16 public holderBps;
    uint16 public protocolBps;

    address[] private _mandateTokens;
    uint16[] private _mandateWeights;

    bool public frozen;
    uint256 public accPerShare;
    uint256 public holderReserve;
    mapping(address => uint256) public shareDebt;
    mapping(address => uint256) public pending;

    Proposal[] private _proposals;
    mapping(uint256 => mapping(address => bool)) private _voted;

    event SeatAdded(address indexed wallet);
    event SeatRemoved(address indexed wallet);
    event Granted(address indexed to, uint256 amount);
    event Proposed(uint256 indexed id, Kind kind, address indexed proposer);
    event Voted(uint256 indexed id, address indexed seat, bool support);
    event Executed(uint256 indexed id);
    event Deposited(uint256 amount, uint256 toHolders, uint256 toPot, uint256 toProtocol);
    event PlatformPaid(address indexed to, uint256 amount);
    event Claimed(address indexed account, uint256 amount);
    event Frozen();
    event HeadSynced(address indexed previous, address indexed next);

    error NotPatriarch();
    error NotSeat();
    error NotShare();
    error FrozenHouse();
    error BadSeat();
    error BadSplit();
    error BadMandate();
    error NoProposal();
    error VotedAlready();
    error TooEarly();
    error TooLate();
    error NotPassed();
    error AlreadyDone();
    error NothingOwed();
    error NotOpener();

    modifier onlyPatriarch() {
        if (certificate.ownerOf(tokenId) != msg.sender) revert NotPatriarch();
        if (frozen || _estateClaimable()) revert FrozenHouse();
        syncHead();
        _;
    }

    modifier live() {
        if (frozen) revert FrozenHouse();
        _;
    }

    constructor(
        address certificate_,
        uint256 tokenId_,
        address pot_,
        address stock_,
        address cash_,
        uint64 votingPeriod_,
        address platform_,
        uint16 platformBps_,
        uint256 maxSupply_
    ) {
        if (certificate_ == address(0) || pot_ == address(0) || stock_ == address(0) || cash_ == address(0)) {
            revert BadSeat();
        }
        if (votingPeriod_ < MIN_VOTING) revert BadSplit();
        if (platformBps_ > 0 && platform_ == address(0)) revert BadSplit();
        if (maxSupply_ == 0) revert BadSplit();
        certificate = IERC721(certificate_);
        tokenId = tokenId_;
        pot = pot_;
        stock = IERC20(stock_);
        cash = IERC20(cash_);
        opener = msg.sender;
        platform = platform_;
        platformBps = platformBps_;
        votingPeriod = votingPeriod_;
        maxSupply = maxSupply_;
        potBps = 3_000;
        holderBps = 7_000;
        protocolBps = 0;
        _mandateTokens.push(stock_);
        _mandateWeights.push(BPS);
        address head = IERC721(certificate_).ownerOf(tokenId_);
        lastHead = head;
        _addSeat(head);
    }

    function attachLaunch(address share_, address book_, address curve_, uint256 curveSupply) external {
        if (msg.sender != opener) revert NotOpener();
        if (address(share) != address(0) || share_ == address(0) || book_ == address(0) || curve_ == address(0)) {
            revert BadSplit();
        }
        if (curveSupply == 0 || curveSupply > maxSupply) revert BadSplit();
        share = FamilyShare(share_);
        book = FamilyShareBook(book_);
        curve = FamilyLaunchCurve(curve_);
        share.mint(curve_, curveSupply);
    }

    function patriarch() public view returns (address) {
        return certificate.ownerOf(tokenId);
    }

    function syncHead() public {
        address head = certificate.ownerOf(tokenId);
        address previous = lastHead;
        if (head == previous) return;
        if (isSeat[previous] && previous != head) _removeSeat(previous);
        if (!isSeat[head]) {
            if (_seats.length >= MAX_SEATS) {
                address evict = _seats[_seats.length - 1];
                if (evict == head) evict = _seats[0];
                _removeSeat(evict);
            }
            _addSeat(head);
        }
        lastHead = head;
        emit HeadSynced(previous, head);
    }

    function seatCount() public view returns (uint256) {
        return _seats.length;
    }

    function seatAt(uint256 i) external view returns (address) {
        return _seats[i];
    }

    function mandate() external view returns (address[] memory tokens, uint16[] memory weights) {
        return (_mandateTokens, _mandateWeights);
    }

    function proposalCount() external view returns (uint256) {
        return _proposals.length;
    }

    function proposal(uint256 id)
        external
        view
        returns (
            Kind kind,
            address[] memory tokens,
            uint16[] memory weights,
            uint64 deadline,
            uint32 yes,
            uint32 no,
            bool executed,
            address proposer
        )
    {
        if (id >= _proposals.length) revert NoProposal();
        Proposal storage p = _proposals[id];
        return (p.kind, p.tokens, p.weights, p.deadline, p.yes, p.no, p.executed, p.proposer);
    }

    function hasVoted(uint256 id, address seat) external view returns (bool) {
        return _voted[id][seat];
    }

    function circulatingShares() public view returns (uint256) {
        uint256 supply = share.totalSupply();
        uint256 parked = share.balanceOf(address(curve));
        return supply > parked ? supply - parked : 0;
    }

    function owed(address account) public view returns (uint256) {
        if (account == address(curve)) return 0;
        uint256 raw = (share.balanceOf(account) * accPerShare) / MAG;
        uint256 debt = shareDebt[account];
        uint256 liveAmt = raw > debt ? raw - debt : 0;
        return liveAmt + pending[account];
    }

    function addSeat(address wallet) external onlyPatriarch live {
        _addSeat(wallet);
    }

    function removeSeat(address wallet) external onlyPatriarch live {
        if (!isSeat[wallet]) revert BadSeat();
        if (wallet == patriarch()) revert BadSeat();
        if (_seats.length <= 1) revert BadSeat();
        _removeSeat(wallet);
    }

    function grant(address to, uint256 amount) external onlyPatriarch live {
        if (to == address(0) || amount == 0) revert BadSeat();
        if (share.totalSupply() + amount > maxSupply) revert BadSeat();
        share.mint(to, amount);
        emit Granted(to, amount);
    }

    function proposeMandate(address[] calldata tokens, uint16[] calldata weights) external live returns (uint256 id) {
        if (!isSeat[msg.sender]) revert NotSeat();
        _assertMandate(tokens, weights);
        id = _proposals.length;
        Proposal storage p = _proposals.push();
        p.kind = Kind.Mandate;
        p.tokens = tokens;
        p.weights = weights;
        p.deadline = uint64(block.timestamp) + votingPeriod;
        p.proposer = msg.sender;
        emit Proposed(id, Kind.Mandate, msg.sender);
    }

    function proposePayee(uint16 potBps_, uint16 holderBps_, uint16 protocolBps_) external live returns (uint256 id) {
        if (!isSeat[msg.sender]) revert NotSeat();
        if (uint256(potBps_) + holderBps_ + protocolBps_ != BPS) revert BadSplit();
        id = _proposals.length;
        Proposal storage p = _proposals.push();
        p.kind = Kind.Payee;
        p.weights = new uint16[](3);
        p.weights[0] = potBps_;
        p.weights[1] = holderBps_;
        p.weights[2] = protocolBps_;
        p.deadline = uint64(block.timestamp) + votingPeriod;
        p.proposer = msg.sender;
        emit Proposed(id, Kind.Payee, msg.sender);
    }

    function vote(uint256 id, bool support) external live {
        if (!isSeat[msg.sender]) revert NotSeat();
        if (id >= _proposals.length) revert NoProposal();
        Proposal storage p = _proposals[id];
        if (p.executed) revert AlreadyDone();
        if (block.timestamp > p.deadline) revert TooLate();
        if (_voted[id][msg.sender]) revert VotedAlready();
        _voted[id][msg.sender] = true;
        if (support) p.yes += 1;
        else p.no += 1;
        emit Voted(id, msg.sender, support);
    }

    function execute(uint256 id) external live {
        if (id >= _proposals.length) revert NoProposal();
        Proposal storage p = _proposals[id];
        if (p.executed) revert AlreadyDone();
        if (block.timestamp <= p.deadline) revert TooEarly();
        uint32 yes = p.yes;
        uint32 no = p.no;
        uint256 seats = _seats.length;
        if (yes <= no || uint256(yes) * 2 <= seats) revert NotPassed();
        p.executed = true;
        if (p.kind == Kind.Mandate) {
            _mandateTokens = p.tokens;
            _mandateWeights = p.weights;
        } else {
            potBps = p.weights[0];
            holderBps = p.weights[1];
            protocolBps = p.weights[2];
        }
        emit Executed(id);
    }

    function deposit(uint256 amount) external nonReentrant {
        if (amount == 0) revert BadSplit();
        if (!_mandateHas(address(stock))) revert BadMandate();

        uint256 before = stock.balanceOf(address(this));
        stock.safeTransferFrom(msg.sender, address(this), amount);
        uint256 received = stock.balanceOf(address(this)) - before;
        if (received == 0) revert BadSplit();

        uint256 toPlatform = platform == address(0) ? 0 : (received * platformBps) / BPS;
        uint256 rest = received - toPlatform;
        uint256 toHolders = (rest * holderBps) / BPS;
        uint256 toPot = (rest * potBps) / BPS;
        uint256 toProto = rest - toHolders - toPot;
        uint256 supply = circulatingShares();
        if (toHolders > 0 && supply == 0) {
            toPot += toHolders;
            toHolders = 0;
        } else if (toHolders > 0) {
            accPerShare += (toHolders * MAG) / supply;
            holderReserve += toHolders;
            address parked = address(curve);
            shareDebt[parked] = (share.balanceOf(parked) * accPerShare) / MAG;
        }
        if (toPlatform > 0) {
            stock.safeTransfer(platform, toPlatform);
            emit PlatformPaid(platform, toPlatform);
        }
        if (toPot > 0) stock.safeTransfer(pot, toPot);
        if (toProto > 0) stock.safeTransfer(pot, toProto);
        emit Deposited(received, toHolders, toPot, toProto);
    }

    function claim() external nonReentrant {
        uint256 amount = owed(msg.sender);
        if (amount == 0) revert NothingOwed();
        pending[msg.sender] = 0;
        shareDebt[msg.sender] = (share.balanceOf(msg.sender) * accPerShare) / MAG;
        holderReserve -= amount;
        stock.safeTransfer(msg.sender, amount);
        emit Claimed(msg.sender, amount);
    }

    function freeze() external onlyPatriarch {
        frozen = true;
        emit Frozen();
    }

    function noteShareTransfer(address from, address to, uint256 value) external nonReentrant {
        if (msg.sender != address(share)) revert NotShare();
        if (value == 0 || accPerShare == 0) return;
        uint256 adj = (value * accPerShare) / MAG;
        if (from == address(curve)) {
            if (to != address(0)) shareDebt[to] += adj;
            return;
        }
        if (from != address(0)) {
            _accrue(from, share.balanceOf(from) + value);
            shareDebt[from] = (share.balanceOf(from) * accPerShare) / MAG;
        }
        if (to != address(0) && to != address(curve)) {
            if (from == address(0)) {
                shareDebt[to] += adj;
            } else {
                _accrue(to, share.balanceOf(to) - value);
                shareDebt[to] = (share.balanceOf(to) * accPerShare) / MAG;
            }
        }
    }

    function _accrue(address account, uint256 oldBal) internal {
        uint256 oldRaw = (oldBal * accPerShare) / MAG;
        uint256 debt = shareDebt[account];
        if (oldRaw > debt) pending[account] += oldRaw - debt;
    }

    function _estateClaimable() internal view returns (bool) {
        return IHeirAccount(pot).isClaimable();
    }

    function _mandateHas(address token) internal view returns (bool) {
        uint256 n = _mandateTokens.length;
        for (uint256 i; i < n;) {
            if (_mandateTokens[i] == token) return true;
            unchecked {
                ++i;
            }
        }
        return false;
    }

    function _addSeat(address wallet) internal {
        if (wallet == address(0) || isSeat[wallet]) revert BadSeat();
        if (_seats.length >= MAX_SEATS) revert BadSeat();
        isSeat[wallet] = true;
        _seats.push(wallet);
        emit SeatAdded(wallet);
    }

    function _removeSeat(address wallet) internal {
        if (!isSeat[wallet]) return;
        isSeat[wallet] = false;
        uint256 n = _seats.length;
        for (uint256 i; i < n;) {
            if (_seats[i] == wallet) {
                _seats[i] = _seats[n - 1];
                _seats.pop();
                break;
            }
            unchecked {
                ++i;
            }
        }
        emit SeatRemoved(wallet);
    }

    function _assertMandate(address[] calldata tokens, uint16[] calldata weights) internal pure {
        uint256 n = tokens.length;
        if (n == 0 || n > MAX_MANDATE || n != weights.length) revert BadMandate();
        uint256 total;
        for (uint256 i; i < n;) {
            if (tokens[i] == address(0) || weights[i] == 0) revert BadMandate();
            for (uint256 j; j < i;) {
                if (tokens[j] == tokens[i]) revert BadMandate();
                unchecked {
                    ++j;
                }
            }
            total += weights[i];
            unchecked {
                ++i;
            }
        }
        if (total != BPS) revert BadMandate();
    }
}
