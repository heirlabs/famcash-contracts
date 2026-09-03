// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

/// @notice Optional hook on the estate certificate. First successful claim
///         asks the NFT to stop transferring (office ends).
interface ISoulbindable {
    function soulbind(uint256 tokenId) external;
}
