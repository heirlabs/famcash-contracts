// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import {AccessControlDefaultAdminRules} from "@openzeppelin/contracts/access/extensions/AccessControlDefaultAdminRules.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {HeirAccount} from "./HeirAccount.sol";
import {HeirEstateCertificate} from "./HeirEstateCertificate.sol";
import {IHeirAccount} from "./interfaces/IHeirAccount.sol";
import {IERC6551Registry} from "./interfaces/IERC6551Registry.sol";
import {OfficeRoles} from "./OfficeRoles.sol";

/// @notice One call mints the plate and initializes HeirAccount.
/// @dev If `registry` is set, uses Tokenbound createAccount. If zero, deploys
///      a standalone account (lab / chains without the canonical registry).
///      The shared implementation is locked. initialize is factory-only.
contract OfficeFactory is AccessControlDefaultAdminRules, Pausable {
    bytes32 public constant SALT = bytes32(0);
    bytes32 public constant PAUSER_ROLE = OfficeRoles.PAUSER_ROLE;

    IERC6551Registry public immutable registry;
    address public immutable implementation;
    address public immutable cashToken;
    HeirEstateCertificate public immutable certificate;

    event OfficeOpened(uint256 indexed tokenId, address indexed account, address indexed owner);

    constructor(address registry_, address cashToken_)
        AccessControlDefaultAdminRules(OfficeRoles.ADMIN_DELAY, msg.sender)
    {
        registry = IERC6551Registry(registry_);
        cashToken = cashToken_;
        implementation = address(new HeirAccount(address(this), true));
        certificate = new HeirEstateCertificate(address(this));
        _grantRole(PAUSER_ROLE, msg.sender);
    }

    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }

    function openOffice(IHeirAccount.Rules calldata rules, IHeirAccount.Beneficiary[] calldata beneficiaries)
        external
        whenNotPaused
        returns (uint256 tokenId, address account)
    {
        return _openOffice(rules, beneficiaries, new address[](0));
    }

    function openOfficeWithTokens(
        IHeirAccount.Rules calldata rules,
        IHeirAccount.Beneficiary[] calldata beneficiaries,
        address[] calldata extraTokens
    ) external whenNotPaused returns (uint256 tokenId, address account) {
        return _openOffice(rules, beneficiaries, extraTokens);
    }

    function _openOffice(
        IHeirAccount.Rules calldata rules,
        IHeirAccount.Beneficiary[] calldata beneficiaries,
        address[] memory extraTokens
    ) internal returns (uint256 tokenId, address account) {
        tokenId = certificate.mint(msg.sender);
        account = _createAccount(tokenId);
        certificate.bindAccount(tokenId, account);
        HeirAccount(payable(account)).initialize(
            address(certificate),
            tokenId,
            rules,
            beneficiaries,
            _allowed(extraTokens)
        );
        emit OfficeOpened(tokenId, account, msg.sender);
    }

    function _allowed(address[] memory extraTokens) internal view returns (address[] memory allowed) {
        if (extraTokens.length == 0) {
            if (cashToken == address(0)) return new address[](0);
            allowed = new address[](1);
            allowed[0] = cashToken;
            return allowed;
        }
        address[] memory scratch = new address[](extraTokens.length + 1);
        uint256 w;
        if (cashToken != address(0)) {
            scratch[0] = cashToken;
            w = 1;
        }
        for (uint256 i; i < extraTokens.length;) {
            address token = extraTokens[i];
            if (token == address(0) || token == cashToken) {
                unchecked {
                    ++i;
                }
                continue;
            }
            bool seen;
            for (uint256 j; j < w;) {
                if (scratch[j] == token) {
                    seen = true;
                    break;
                }
                unchecked {
                    ++j;
                }
            }
            if (!seen) {
                scratch[w] = token;
                w += 1;
            }
            unchecked {
                ++i;
            }
        }
        allowed = new address[](w);
        for (uint256 i; i < w;) {
            allowed[i] = scratch[i];
            unchecked {
                ++i;
            }
        }
    }

    function _createAccount(uint256 tokenId) internal returns (address account) {
        if (address(registry) == address(0)) {
            return address(new HeirAccount(address(this), false));
        }
        return registry.createAccount(implementation, SALT, block.chainid, address(certificate), tokenId);
    }
}
