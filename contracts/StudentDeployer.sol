// SPDX-License-Identifier: GPL-3.0

pragma solidity >=0.8.2;

import "./Student.sol";

/**
 * @title StudentDeployer
 * @author Diego Da Giau, extended for EduWallet V3.0
 * @dev Deploys Student wallets using CREATE2 so the address is deterministic
 *      and can be computed off-chain before deployment (counterfactual address).
 *
 *      Salt = bytes32(uint256(uint160(_student))) — one wallet per EOA.
 */
contract StudentDeployer {
    /**
     * @notice Deploys a new Student wallet with a deterministic address.
     * @param _university University address that receives initial WRITER_ROLE
     * @param _student    Student EOA — also determines the CREATE2 salt
     * @param _didKeyHash keccak256 of the student's did:key string
     * @param _entryPoint ERC-4337 EntryPoint contract
     * @return addr Address of the newly deployed Student contract
     */
    function deploy(
        address _university,
        address _student,
        bytes32 _didKeyHash,
        IEntryPoint _entryPoint
    ) external returns (address addr) {
        bytes32 salt = bytes32(uint256(uint160(_student)));
        Student account = new Student{salt: salt}(
            _university,
            _student,
            _didKeyHash,
            _entryPoint
        );
        return address(account);
    }

    /**
     * @notice Computes the counterfactual address a Student wallet will have
     *         once deployed via `deploy()`.  Can be called before deployment.
     * @param _university University address that receives initial WRITER_ROLE
     * @param _student    Student EOA (determines the CREATE2 salt)
     * @param _didKeyHash keccak256 of the student's did:key string
     * @param _entryPoint ERC-4337 EntryPoint contract
     * @return The address the Student contract will occupy after deployment
     */
    function computeAddress(
        address _university,
        address _student,
        bytes32 _didKeyHash,
        IEntryPoint _entryPoint
    ) external view returns (address) {
        bytes32 salt = bytes32(uint256(uint160(_student)));
        bytes32 initCodeHash = keccak256(
            abi.encodePacked(
                type(Student).creationCode,
                abi.encode(_university, _student, _didKeyHash, _entryPoint)
            )
        );
        return address(
            uint160(
                uint256(
                    keccak256(
                        abi.encodePacked(bytes1(0xff), address(this), salt, initCodeHash)
                    )
                )
            )
        );
    }
}
