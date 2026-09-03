// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IHouseLaunch {
    function frozen() external view returns (bool);
    function patriarch() external view returns (address);
}

/// @notice Per-family launch curve. Cash in, shares out. Sniper tax to the pot.
/// @dev Constant product with a phantom cash reserve. No DEX graduation.
///      Prices against tracked curveShares, not balanceOf (donations ignored).
contract FamilyLaunchCurve is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint16 public constant BPS = 10_000;
    uint16 public constant SNIPE_START_BPS = 9_900;
    uint16 public constant TRADE_FEE_BPS = 100;
    uint256 public constant SNIPE_SHIFT = 14;

    address public immutable house;
    IERC20 public immutable share;
    IERC20 public immutable cash;
    address public immutable pot;
    address public immutable platform;
    uint256 public immutable supply;
    uint256 public immutable phantom;
    uint256 public immutable graduationQuote;
    uint64 public immutable openedAt;
    uint64 public immutable snipeSeconds;

    uint256 public realQuote;
    uint256 public curveShares;
    bool public graduated;

    event Seeded(address indexed from, uint256 amount);
    event Bought(address indexed buyer, uint256 quoteIn, uint256 sharesOut, uint16 snipeBps, uint256 savings);
    event Sold(address indexed seller, uint256 sharesIn, uint256 quoteOut, uint256 fee);
    event Graduated(uint256 quoteToPot, uint256 leftover);

    error FrozenHouse();
    error BadLaunch();
    error ClosedCurve();
    error Slippage();
    error NotPatriarch();

    modifier live() {
        if (IHouseLaunch(house).frozen()) revert FrozenHouse();
        if (graduated) revert ClosedCurve();
        _;
    }

    constructor(
        address house_,
        address share_,
        address cash_,
        address pot_,
        uint256 supply_,
        uint256 graduationQuote_,
        uint64 snipeSeconds_,
        address platform_
    ) {
        if (house_ == address(0) || share_ == address(0) || cash_ == address(0) || pot_ == address(0)) revert BadLaunch();
        if (supply_ == 0 || graduationQuote_ == 0 || snipeSeconds_ == 0) revert BadLaunch();
        house = house_;
        share = IERC20(share_);
        cash = IERC20(cash_);
        pot = pot_;
        platform = platform_;
        supply = supply_;
        graduationQuote = graduationQuote_;
        phantom = graduationQuote_ / 4;
        if (phantom == 0) revert BadLaunch();
        openedAt = uint64(block.timestamp);
        snipeSeconds = snipeSeconds_;
        curveShares = supply_;
    }

    function k() public view returns (uint256) {
        return phantom * supply;
    }

    function tokenReserve() public view returns (uint256) {
        return curveShares;
    }

    function virtualQuote() public view returns (uint256) {
        return phantom + realQuote;
    }

    function currentSnipeTaxBps(address) public view returns (uint16) {
        if (graduated) return 0;
        uint256 elapsed = block.timestamp - uint256(openedAt);
        if (elapsed >= snipeSeconds) return 0;
        uint256 shift = (elapsed * SNIPE_SHIFT) / uint256(snipeSeconds);
        if (shift >= 16) return 0;
        return uint16(uint256(SNIPE_START_BPS) >> shift);
    }

    function previewBuy(uint256 quoteIn, address recipient)
        public
        view
        returns (uint256 sharesOut, uint256 fee, uint256 snipe, uint256 netIn)
    {
        if (quoteIn == 0 || graduated) return (0, 0, 0, 0);
        uint16 taxBps = currentSnipeTaxBps(recipient);
        uint256 used = _usedGross(quoteIn, taxBps);
        fee = (used * TRADE_FEE_BPS) / BPS;
        snipe = ((used - fee) * taxBps) / BPS;
        netIn = used - fee - snipe;
        uint256 reserve = curveShares;
        uint256 nextTokens = k() / (virtualQuote() + netIn);
        if (nextTokens >= reserve) return (0, fee, snipe, netIn);
        sharesOut = reserve - nextTokens;
    }

    function previewSell(uint256 sharesIn) public view returns (uint256 quoteOut, uint256 fee) {
        if (sharesIn == 0 || graduated || sharesIn > curveShares) return (0, 0);
        uint256 nextTokens = curveShares + sharesIn;
        uint256 nextV = k() / nextTokens;
        uint256 v = virtualQuote();
        if (nextV >= v) return (0, 0);
        uint256 gross = v - nextV;
        if (gross > realQuote) gross = realQuote;
        fee = (gross * TRADE_FEE_BPS) / BPS;
        if (fee >= gross) return (0, fee);
        quoteOut = gross - fee;
    }

    function seed(uint256 amount) external live nonReentrant {
        if (IHouseLaunch(house).patriarch() != msg.sender) revert NotPatriarch();
        if (amount == 0 || realQuote + amount >= graduationQuote) revert BadLaunch();
        uint256 before = cash.balanceOf(address(this));
        cash.safeTransferFrom(msg.sender, address(this), amount);
        uint256 received = cash.balanceOf(address(this)) - before;
        if (received == 0) revert BadLaunch();
        if (realQuote + received >= graduationQuote) revert BadLaunch();
        realQuote += received;
        emit Seeded(msg.sender, received);
    }

    function buy(uint256 quoteIn, uint256 minSharesOut, uint256 deadline) external live nonReentrant {
        if (block.timestamp > deadline) revert Slippage();
        if (quoteIn == 0) revert BadLaunch();
        uint256 before = cash.balanceOf(address(this));
        cash.safeTransferFrom(msg.sender, address(this), quoteIn);
        uint256 received = cash.balanceOf(address(this)) - before;
        if (received == 0) revert BadLaunch();
        _fillBuy(received, minSharesOut);
    }

    function _fillBuy(uint256 quoteIn, uint256 minSharesOut) internal {
        uint16 taxBps = currentSnipeTaxBps(msg.sender);
        uint256 used = _usedGross(quoteIn, taxBps);
        uint256 refund = quoteIn - used;
        uint256 fee = (used * TRADE_FEE_BPS) / BPS;
        uint256 snipe = ((used - fee) * taxBps) / BPS;
        uint256 netIn = used - fee - snipe;
        uint256 reserve = curveShares;
        uint256 nextTokens = k() / (virtualQuote() + netIn);
        if (nextTokens >= reserve) revert BadLaunch();
        uint256 sharesOut = reserve - nextTokens;
        if (sharesOut < minSharesOut) revert Slippage();
        realQuote += netIn;
        curveShares = reserve - sharesOut;
        if (fee > 0) cash.safeTransfer(_feeTo(), fee);
        if (snipe > 0) cash.safeTransfer(pot, snipe);
        if (refund > 0) cash.safeTransfer(msg.sender, refund);
        share.safeTransfer(msg.sender, sharesOut);
        emit Bought(msg.sender, used, sharesOut, taxBps, fee + snipe);
        if (realQuote >= graduationQuote) _graduate();
    }

    function _usedGross(uint256 quoteIn, uint16 taxBps) internal view returns (uint256 used) {
        uint256 netBps = (uint256(BPS) - TRADE_FEE_BPS) * (uint256(BPS) - taxBps);
        uint256 maxGross = ((graduationQuote - realQuote) * uint256(BPS) * uint256(BPS)) / netBps;
        used = quoteIn > maxGross ? maxGross : quoteIn;
    }

    function sell(uint256 sharesIn, uint256 minQuoteOut, uint256 deadline) external live nonReentrant {
        if (block.timestamp > deadline) revert Slippage();
        (uint256 quoteOut, uint256 fee) = previewSell(sharesIn);
        if (quoteOut == 0) revert BadLaunch();
        if (quoteOut < minQuoteOut) revert Slippage();
        share.safeTransferFrom(msg.sender, address(this), sharesIn);
        curveShares += sharesIn;
        uint256 gross = quoteOut + fee;
        realQuote -= gross;
        if (fee > 0) cash.safeTransfer(_feeTo(), fee);
        cash.safeTransfer(msg.sender, quoteOut);
        emit Sold(msg.sender, sharesIn, quoteOut, fee);
    }

    function _feeTo() internal view returns (address) {
        return platform == address(0) ? pot : platform;
    }

    function _graduate() internal {
        graduated = true;
        uint256 quoteToPot = cash.balanceOf(address(this));
        uint256 leftover = share.balanceOf(address(this));
        if (quoteToPot > 0) cash.safeTransfer(pot, quoteToPot);
        if (leftover > 0) share.safeTransfer(pot, leftover);
        curveShares = 0;
        emit Graduated(quoteToPot, leftover);
    }
}
