// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import {HeirAccount} from "../HeirAccount.sol";
import {IHeirAccount} from "../interfaces/IHeirAccount.sol";

contract Mock6551Registry {
    event AccountCreated(address account, address tokenContract, uint256 tokenId);

    function createAccount(
        address tokenContract,
        uint256 tokenId,
        IHeirAccount.Rules calldata rules,
        IHeirAccount.Beneficiary[] calldata beneficiaries,
        address[] calldata allowedTokens
    ) external returns (address) {
        HeirAccount account = new HeirAccount(address(this), false);
        account.initialize(tokenContract, tokenId, rules, beneficiaries, allowedTokens);
        emit AccountCreated(address(account), tokenContract, tokenId);
        return address(account);
    }
}
