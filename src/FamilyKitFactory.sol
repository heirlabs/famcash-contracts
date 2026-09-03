// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import {AccessControlDefaultAdminRules} from "@openzeppelin/contracts/access/extensions/AccessControlDefaultAdminRules.sol";
import {FamilyShare} from "./FamilyShare.sol";
import {FamilyShareBook} from "./FamilyShareBook.sol";
import {FamilyLaunchCurve} from "./FamilyLaunchCurve.sol";
import {OfficeRoles} from "./OfficeRoles.sol";

/// @notice Deploys the share, book, and launch curve for one house.
/// @dev Split from OfficeHouseFactory so each factory fits Robinhood Chain's 24kb cap.
contract FamilyKitFactory is AccessControlDefaultAdminRules {
    bytes32 public constant KIT_DEPLOYER_ROLE = OfficeRoles.KIT_DEPLOYER_ROLE;

    struct KitArgs {
        address house;
        address stock;
        address cash;
        address pot;
        string shareName;
        string shareSymbol;
        uint256 curveSupply;
        uint256 graduationQuote;
        uint64 snipeSeconds;
        address platform;
    }

    error BadLaunch();

    constructor(address admin, address houseFactory_)
        AccessControlDefaultAdminRules(OfficeRoles.ADMIN_DELAY, admin)
    {
        if (houseFactory_ == address(0)) revert BadLaunch();
        _grantRole(KIT_DEPLOYER_ROLE, houseFactory_);
    }

    function deploy(KitArgs calldata a) external onlyRole(KIT_DEPLOYER_ROLE) returns (address share, address book, address curve) {
        if (a.house == address(0) || a.stock == address(0) || a.cash == address(0) || a.pot == address(0)) {
            revert BadLaunch();
        }
        if (a.curveSupply == 0 || a.graduationQuote == 0 || a.snipeSeconds == 0) revert BadLaunch();
        FamilyShare fam = new FamilyShare(a.shareName, a.shareSymbol, a.house);
        FamilyShareBook nextBook = new FamilyShareBook(a.house, address(fam), a.stock);
        FamilyLaunchCurve nextCurve = new FamilyLaunchCurve(
            a.house,
            address(fam),
            a.cash,
            a.pot,
            a.curveSupply,
            a.graduationQuote,
            a.snipeSeconds,
            a.platform
        );
        return (address(fam), address(nextBook), address(nextCurve));
    }
}
