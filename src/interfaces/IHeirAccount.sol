// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

/// @notice HEIR inheritance rules on a 6551-shaped token-bound account.
/// @dev Product ABI. Do not market as an official ERC. oracleEnabled is rejected
///      until a bound feed exists.
interface IHeirAccount {
    struct Rules {
        uint64 inactivityPeriod;
        uint64 gracePeriod;
        bool oracleEnabled;
        bytes32 jurisdictionId;
    }

    struct Beneficiary {
        address wallet;
        uint16 shareBps;
        bytes32 emailHash;
    }

    function factory() external view returns (address);
    function checkIn() external;
    function lastActive() external view returns (uint64);
    function isClaimable() external view returns (bool);
    function rules() external view returns (Rules memory);
    function beneficiaryCount() external view returns (uint256);
    function beneficiaryAt(uint256 index) external view returns (Beneficiary memory);
    function allowedTokenCount() external view returns (uint256);
    function allowedTokenAt(uint256 index) external view returns (address);
    function claim() external;
    function setBeneficiaries(Beneficiary[] calldata next) external;
    function withdrawETH() external;
    function skimDust() external;
}
