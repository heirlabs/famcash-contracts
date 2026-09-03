// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

interface IOfficeHouse {
    function noteShareTransfer(address from, address to, uint256 value) external;
}
