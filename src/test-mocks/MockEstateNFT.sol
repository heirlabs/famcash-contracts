// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ISoulbindable} from "../interfaces/ISoulbindable.sol";

contract MockEstateNFT is ERC721, ISoulbindable {
    mapping(uint256 => bool) public locked;
    error Soulbound();

    constructor() ERC721("HEIR Estate Certificate", "ESTATE") {}

    function mint(address to, uint256 tokenId) external {
        _mint(to, tokenId);
    }

    function soulbind(uint256 tokenId) external {
        locked[tokenId] = true;
    }

    function _update(address to, uint256 tokenId, address auth) internal override returns (address) {
        if (locked[tokenId] && to != address(0)) revert Soulbound();
        return super._update(to, tokenId, auth);
    }
}
