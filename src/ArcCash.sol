// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

/// @notice Arc native USDC is also the ERC-20 at this address (6 decimals).
///         A pot that allowlists it must not also sweep address.balance.
library ArcCash {
    address internal constant USDC = 0x3600000000000000000000000000000000000000;
    uint256 internal constant MAINNET = 5042;
    uint256 internal constant TESTNET = 5042002;

    function isArc(uint256 chainId) internal pure returns (bool) {
        return chainId == MAINNET || chainId == TESTNET;
    }

    function nativeIsCash(uint256 chainId, address token) internal pure returns (bool) {
        return isArc(chainId) && token == USDC;
    }

    function nativeIsCashList(uint256 chainId, address[] storage tokens) internal view returns (bool) {
        if (!isArc(chainId)) return false;
        uint256 n = tokens.length;
        for (uint256 i; i < n;) {
            if (tokens[i] == USDC) return true;
            unchecked {
                ++i;
            }
        }
        return false;
    }
}
