// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IHouseLive {
    function frozen() external view returns (bool);
}

/// @notice Per-family book. Family shares versus practice stock.
/// @dev Bids lock stock. Asks escrow shares until fill or cancel.
contract FamilyShareBook is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant SHARE_UNIT = 1e18;
    uint256 public constant MAX_OPEN = 64;
    uint256 public constant MAX_PRINTS = 48;

    enum Side {
        Bid,
        Ask
    }

    struct Order {
        address maker;
        Side side;
        uint256 price;
        uint256 remaining;
        uint256 lockedQuote;
        bool open;
    }

    struct Print {
        uint256 price;
        uint256 shares;
        uint64 at;
        address taker;
        uint256 orderId;
    }

    address public immutable house;
    IERC20 public immutable share;
    IERC20 public immutable quote;

    Order[] private _orders;
    uint256[] private _openIds;
    mapping(uint256 => uint256) private _openIndex;
    Print[MAX_PRINTS] private _prints;
    uint256 public printTotal;
    uint32 public openCount;

    event Posted(uint256 indexed id, address indexed maker, Side side, uint256 price, uint256 shares);
    event Filled(uint256 indexed id, address indexed taker, uint256 shares, uint256 quotePaid);
    event Cancelled(uint256 indexed id);

    error FrozenHouse();
    error BadOrder();
    error NotMaker();
    error ClosedOrder();
    error TooManyOpen();
    error UnpaidAsk();

    modifier live() {
        if (IHouseLive(house).frozen()) revert FrozenHouse();
        _;
    }

    constructor(address house_, address share_, address quote_) {
        if (house_ == address(0) || share_ == address(0) || quote_ == address(0)) revert BadOrder();
        house = house_;
        share = IERC20(share_);
        quote = IERC20(quote_);
    }

    function quoteFor(uint256 shares, uint256 price) public pure returns (uint256) {
        if (shares == 0 || price == 0) revert BadOrder();
        if ((shares * price) % SHARE_UNIT != 0) revert BadOrder();
        return (shares * price) / SHARE_UNIT;
    }

    function orderCount() external view returns (uint256) {
        return _orders.length;
    }

    function orderAt(uint256 id)
        external
        view
        returns (address maker, Side side, uint256 price, uint256 remaining, uint256 lockedQuote, bool open)
    {
        if (id >= _orders.length) revert BadOrder();
        Order storage o = _orders[id];
        return (o.maker, o.side, o.price, o.remaining, o.lockedQuote, o.open);
    }

    function printCount() public view returns (uint256) {
        return printTotal < MAX_PRINTS ? printTotal : MAX_PRINTS;
    }

    function printAt(uint256 i)
        external
        view
        returns (uint256 price, uint256 shares, uint64 at, address taker, uint256 orderId)
    {
        uint256 n = printCount();
        if (i >= n) revert BadOrder();
        uint256 idx = printTotal <= MAX_PRINTS ? i : (printTotal - n + i) % MAX_PRINTS;
        Print storage p = _prints[idx];
        return (p.price, p.shares, p.at, p.taker, p.orderId);
    }

    function bestBid() external view returns (uint256 id, uint256 price, uint256 remaining) {
        bool found;
        uint256 n = _openIds.length;
        for (uint256 i; i < n;) {
            uint256 oid = _openIds[i];
            Order storage o = _orders[oid];
            if (o.open && o.side == Side.Bid && (!found || o.price > price)) {
                found = true;
                id = oid;
                price = o.price;
                remaining = o.remaining;
            }
            unchecked {
                ++i;
            }
        }
    }

    function bestAsk() external view returns (uint256 id, uint256 price, uint256 remaining) {
        bool found;
        uint256 n = _openIds.length;
        for (uint256 i; i < n;) {
            uint256 oid = _openIds[i];
            Order storage o = _orders[oid];
            if (o.open && o.side == Side.Ask && (!found || o.price < price)) {
                found = true;
                id = oid;
                price = o.price;
                remaining = o.remaining;
            }
            unchecked {
                ++i;
            }
        }
    }

    function postBid(uint256 price, uint256 shares) external live nonReentrant returns (uint256 id) {
        uint256 cost = quoteFor(shares, price);
        if (openCount >= MAX_OPEN) revert TooManyOpen();
        uint256 before = quote.balanceOf(address(this));
        quote.safeTransferFrom(msg.sender, address(this), cost);
        if (quote.balanceOf(address(this)) - before != cost) revert BadOrder();
        id = _orders.length;
        _orders.push(Order({
            maker: msg.sender,
            side: Side.Bid,
            price: price,
            remaining: shares,
            lockedQuote: cost,
            open: true
        }));
        openCount += 1;
        _track(id);
        emit Posted(id, msg.sender, Side.Bid, price, shares);
    }

    function postAsk(uint256 price, uint256 shares) external live nonReentrant returns (uint256 id) {
        quoteFor(shares, price);
        if (openCount >= MAX_OPEN) revert TooManyOpen();
        if (share.balanceOf(msg.sender) < shares) revert UnpaidAsk();
        share.safeTransferFrom(msg.sender, address(this), shares);
        id = _orders.length;
        _orders.push(Order({
            maker: msg.sender,
            side: Side.Ask,
            price: price,
            remaining: shares,
            lockedQuote: 0,
            open: true
        }));
        openCount += 1;
        _track(id);
        emit Posted(id, msg.sender, Side.Ask, price, shares);
    }

    function fill(uint256 id, uint256 shares) external live nonReentrant {
        if (id >= _orders.length) revert BadOrder();
        Order storage o = _orders[id];
        if (!o.open) revert ClosedOrder();
        if (shares == 0 || shares > o.remaining) revert BadOrder();
        if (msg.sender == o.maker) revert BadOrder();
        uint256 price = o.price;
        uint256 cost = quoteFor(shares, price);
        if (o.side == Side.Bid) {
            share.safeTransferFrom(msg.sender, o.maker, shares);
            quote.safeTransfer(msg.sender, cost);
            o.lockedQuote -= cost;
        } else {
            share.safeTransfer(msg.sender, shares);
            quote.safeTransferFrom(msg.sender, o.maker, cost);
        }
        o.remaining -= shares;
        if (o.remaining == 0) {
            o.open = false;
            openCount -= 1;
            _untrack(id);
        }
        _notePrint(price, shares, msg.sender, id);
        emit Filled(id, msg.sender, shares, cost);
    }

    function cancel(uint256 id) external nonReentrant {
        if (id >= _orders.length) revert BadOrder();
        Order storage o = _orders[id];
        if (!o.open) revert ClosedOrder();
        if (o.maker != msg.sender) revert NotMaker();
        o.open = false;
        openCount -= 1;
        _untrack(id);
        uint256 back = o.lockedQuote;
        uint256 leftover = o.remaining;
        o.lockedQuote = 0;
        o.remaining = 0;
        if (o.side == Side.Ask && leftover > 0) share.safeTransfer(o.maker, leftover);
        if (back > 0) quote.safeTransfer(o.maker, back);
        emit Cancelled(id);
    }

    function _track(uint256 id) internal {
        _openIds.push(id);
        _openIndex[id] = _openIds.length;
    }

    function _untrack(uint256 id) internal {
        uint256 i = _openIndex[id];
        if (i == 0) return;
        uint256 lastId = _openIds[_openIds.length - 1];
        _openIds[i - 1] = lastId;
        _openIndex[lastId] = i;
        _openIds.pop();
        delete _openIndex[id];
    }

    function _notePrint(uint256 price, uint256 shares, address taker, uint256 orderId) internal {
        _prints[printTotal % MAX_PRINTS] = Print({
            price: price,
            shares: shares,
            at: uint64(block.timestamp),
            taker: taker,
            orderId: orderId
        });
        printTotal += 1;
    }
}
