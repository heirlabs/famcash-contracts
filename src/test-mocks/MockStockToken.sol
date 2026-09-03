// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {OfficeRoles} from "../OfficeRoles.sol";

/// @notice Practice stock for the local office house. Not Tesla. Not title.
contract MockStockToken is ERC20, AccessControl {
    bytes32 public constant MINTER_ROLE = OfficeRoles.MINTER_ROLE;

    constructor() ERC20("Practice Stock", "STOK") {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(OfficeRoles.MINTER_ROLE, msg.sender);
    }

    function mint(address to, uint256 amount) external onlyRole(OfficeRoles.MINTER_ROLE) {
        _mint(to, amount);
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }
}
