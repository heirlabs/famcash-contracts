// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import {HeirAccount} from "../HeirAccount.sol";

/// @notice Test stand-in for the canonical Tokenbound registry. Deploys an
///         uninitialized HeirAccount whose factory is the caller (OfficeFactory).
contract MockTokenboundRegistry {
    event AccountCreated(address account);

    function createAccount(address, bytes32, uint256, address, uint256) external returns (address) {
        HeirAccount created = new HeirAccount(msg.sender, false);
        emit AccountCreated(address(created));
        return address(created);
    }

    function account(address, bytes32, uint256, address, uint256) external pure returns (address) {
        return address(0);
    }
}
