// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import {AccessControlDefaultAdminRules} from "@openzeppelin/contracts/access/extensions/AccessControlDefaultAdminRules.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {OfficeHouse} from "./OfficeHouse.sol";
import {FamilyKitFactory} from "./FamilyKitFactory.sol";
import {HeirEstateCertificate} from "./HeirEstateCertificate.sol";
import {OfficeRoles} from "./OfficeRoles.sol";

/// @notice Deploys one OfficeHouse per family key, then asks the kit for the launch set.
contract OfficeHouseFactory is AccessControlDefaultAdminRules, Pausable {
    bytes32 public constant PAUSER_ROLE = OfficeRoles.PAUSER_ROLE;

    struct OpenArgs {
        address certificate;
        uint256 tokenId;
        address pot;
        address stock;
        address cash;
        string shareName;
        string shareSymbol;
        uint64 votingPeriod;
        uint256 curveSupply;
        uint256 graduationQuote;
        uint64 snipeSeconds;
        uint256 maxSupply;
    }

    FamilyKitFactory public immutable kit;
    address public immutable platform;
    uint16 public immutable platformBps;
    address public immutable officialCertificate;
    mapping(bytes32 => bool) public opened;

    event HouseOpened(
        address indexed house,
        address indexed certificate,
        uint256 indexed tokenId,
        address share,
        address curve
    );

    error NotPatriarch();
    error BadLaunch();

    constructor(address platform_, uint16 platformBps_, address officialCertificate_)
        AccessControlDefaultAdminRules(OfficeRoles.ADMIN_DELAY, msg.sender)
    {
        if (platformBps_ > 1_500) revert BadLaunch();
        if (platformBps_ > 0 && platform_ == address(0)) revert BadLaunch();
        if (officialCertificate_ == address(0)) revert BadLaunch();
        officialCertificate = officialCertificate_;
        kit = new FamilyKitFactory(msg.sender, address(this));
        platform = platform_;
        platformBps = platformBps_;
        _grantRole(PAUSER_ROLE, msg.sender);
    }

    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }

    function openHouse(OpenArgs calldata a) external whenNotPaused returns (address house, address share) {
        if (a.certificate != officialCertificate) revert BadLaunch();
        if (IERC721(a.certificate).ownerOf(a.tokenId) != msg.sender) revert NotPatriarch();
        if (a.curveSupply == 0 || a.graduationQuote == 0 || a.snipeSeconds == 0) revert BadLaunch();
        if (a.votingPeriod < 3 days) revert BadLaunch();
        if (a.maxSupply < a.curveSupply) revert BadLaunch();
        if (HeirEstateCertificate(a.certificate).accountOf(a.tokenId) != a.pot) revert BadLaunch();
        bytes32 key = keccak256(abi.encode(a.certificate, a.tokenId));
        if (opened[key]) revert BadLaunch();
        opened[key] = true;
        OfficeHouse openedHouse = new OfficeHouse(
            a.certificate,
            a.tokenId,
            a.pot,
            a.stock,
            a.cash,
            a.votingPeriod,
            platform,
            platformBps,
            a.maxSupply
        );
        (address fam, address book, address curve) = kit.deploy(
            FamilyKitFactory.KitArgs({
                house: address(openedHouse),
                stock: a.stock,
                cash: a.cash,
                pot: a.pot,
                shareName: a.shareName,
                shareSymbol: a.shareSymbol,
                curveSupply: a.curveSupply,
                graduationQuote: a.graduationQuote,
                snipeSeconds: a.snipeSeconds,
                platform: platform
            })
        );
        openedHouse.attachLaunch(fam, book, curve, a.curveSupply);
        house = address(openedHouse);
        share = fam;
        emit HouseOpened(house, a.certificate, a.tokenId, share, curve);
    }
}
