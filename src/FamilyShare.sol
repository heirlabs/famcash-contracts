// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IOfficeHouse} from "./interfaces/IOfficeHouse.sol";

/// @notice Per-family share. Transferable. Holding it is not a vote.
contract FamilyShare is ERC20 {
    address public immutable house;

    error NotHouse();

    constructor(string memory name_, string memory symbol_, address house_) ERC20(name_, symbol_) {
        house = house_;
    }

    function mint(address to, uint256 amount) external {
        if (msg.sender != house) revert NotHouse();
        _mint(to, amount);
    }

    function _update(address from, address to, uint256 value) internal override {
        super._update(from, to, value);
        IOfficeHouse(house).noteShareTransfer(from, to, value);
    }
}
