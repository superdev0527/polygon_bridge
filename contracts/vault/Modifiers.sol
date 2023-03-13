// SPDX-License-Identifier: MIT
pragma solidity >=0.8.17;

import {Variables} from "./Variables.sol";
import "./Errors.sol";

contract Modifiers is Variables {
    /// @notice checks if an address is not 0x000...
    modifier validAddress(address _address) {
        if (_address == address(0)) {
            revert LiteVault__InvalidParams();
        }
        _;
    }

    /// @notice checks if a percentage value is within the maximumPercentageRange
    modifier validPercentage(uint256 _percentage) {
        if (_percentage > maximumPercentageRange) {
            revert LiteVault__InvalidParams();
        }
        _;
    }

    /// @notice checks if msg.sender is an allowed rebalancer
    modifier onlyAllowedRebalancer() {
        if (allowedRebalancers[msg.sender] != true) {
            revert LiteVault__Unauthorized();
        }
        _;
    }

    /// @notice checks if msg.sender is the bridge
    modifier onlyBridge() {
        if (msg.sender != bridgeAddress) {
            revert LiteVault__Unauthorized();
        }
        _;
    }
}
