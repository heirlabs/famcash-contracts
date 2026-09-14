// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {OfficeRoles} from "../OfficeRoles.sol";

/// @notice Practice ERC-20. Mint is role-gated to the deployer. Not official USDG or WETH.
contract MockMintableToken is ERC20, AccessControl {
    bytes32 public constant MINTER_ROLE = OfficeRoles.MINTER_ROLE;

    uint8 private immutable _decimals;

    constructor(string memory name_, string memory symbol_, uint8 decimals_) ERC20(name_, symbol_) {
        _decimals = decimals_;
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(OfficeRoles.MINTER_ROLE, msg.sender);
    }

    function mint(address to, uint256 amount) external onlyRole(OfficeRoles.MINTER_ROLE) {
        _mint(to, amount);
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }
}
