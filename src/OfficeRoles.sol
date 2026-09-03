// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

/// @notice Shared AccessControl role ids and admin delay for the office suite.
library OfficeRoles {
    bytes32 internal constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    bytes32 internal constant KIT_DEPLOYER_ROLE = keccak256("KIT_DEPLOYER_ROLE");
    bytes32 internal constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 internal constant FACTORY_ROLE = keccak256("FACTORY_ROLE");

    uint48 internal constant ADMIN_DELAY = 3 days;
}
