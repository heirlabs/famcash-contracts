// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import {ArcCash} from "../ArcCash.sol";

contract ArcCashHarness {
    function isArc(uint256 chainId) external pure returns (bool) {
        return ArcCash.isArc(chainId);
    }

    function nativeIsCash(uint256 chainId, address token) external pure returns (bool) {
        return ArcCash.nativeIsCash(chainId, token);
    }
}
