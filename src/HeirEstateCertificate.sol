// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ISoulbindable} from "./interfaces/ISoulbindable.sol";
import {OfficeRoles} from "./OfficeRoles.sol";

/// @notice Household office plate. Not a HeirBear. First claim soulbinds it.
contract HeirEstateCertificate is ERC721, AccessControl, ISoulbindable {
    address public immutable factory;
    uint256 public nextId = 1;
    mapping(uint256 => bool) public locked;
    mapping(uint256 => address) public accountOf;

    error NotAccount();
    error Soulbound();
    error UnknownToken();

    constructor(address factory_) ERC721("HEIR Estate Certificate", "ESTATE") {
        factory = factory_;
        _grantRole(DEFAULT_ADMIN_ROLE, factory_);
        _grantRole(OfficeRoles.FACTORY_ROLE, factory_);
    }

    function mint(address to) external onlyRole(OfficeRoles.FACTORY_ROLE) returns (uint256 tokenId) {
        tokenId = nextId++;
        _safeMint(to, tokenId);
    }

    function bindAccount(uint256 tokenId, address account) external onlyRole(OfficeRoles.FACTORY_ROLE) {
        if (_ownerOf(tokenId) == address(0)) revert UnknownToken();
        if (accountOf[tokenId] != address(0)) revert Soulbound();
        accountOf[tokenId] = account;
    }

    function soulbind(uint256 tokenId) external {
        if (accountOf[tokenId] == address(0) || msg.sender != accountOf[tokenId]) {
            revert NotAccount();
        }
        locked[tokenId] = true;
    }

    function supportsInterface(bytes4 interfaceId) public view override(ERC721, AccessControl) returns (bool) {
        return super.supportsInterface(interfaceId);
    }

    function _update(address to, uint256 tokenId, address auth) internal override returns (address) {
        if (locked[tokenId] && to != address(0)) revert Soulbound();
        return super._update(to, tokenId, auth);
    }
}
