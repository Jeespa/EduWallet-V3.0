// SPDX-License-Identifier: GPL-3.0

pragma solidity >=0.8.2;

// Custom errors
error NotIssuer();
error AlreadyRegistered();

/**
 * @title VCStatusRegistry
 * @notice On-chain revocation registry for Verifiable Credentials.
 *
 * Each credential is identified by a bytes32 credentialId (keccak256 of the
 * VC's `jti` claim). The issuer who registers a credential is the only party
 * allowed to revoke it. Checking revocation status is a free eth_call.
 *
 */
contract VCStatusRegistry {
    // credentialId => issuer address (address(0) means unregistered)
    mapping(bytes32 => address) private _issuers;
    // credentialId => revoked flag
    mapping(bytes32 => bool) private _revoked;

    event CredentialRegistered(bytes32 indexed credentialId, address indexed issuer);
    event CredentialRevoked(bytes32 indexed credentialId, address indexed issuer);

    /**
     * @notice Registers a new credential so its revocation status can later be set.
     * @dev Can only be called once per credentialId. msg.sender becomes the issuer.
     * @param credentialId keccak256 of the VC's `jti` field
     */
    function register(bytes32 credentialId) external {
        if (_issuers[credentialId] != address(0)) revert AlreadyRegistered();
        _issuers[credentialId] = msg.sender;
        emit CredentialRegistered(credentialId, msg.sender);
    }

    /**
     * @notice Revokes a credential. Only the original issuer may call this.
     * @param credentialId keccak256 of the VC's `jti` field
     */
    function revoke(bytes32 credentialId) external {
        if (_issuers[credentialId] != msg.sender) revert NotIssuer();
        _revoked[credentialId] = true;
        emit CredentialRevoked(credentialId, msg.sender);
    }

    /**
     * @notice Returns true if the credential has been revoked.
     * @param credentialId keccak256 of the VC's `jti` field
     */
    function isRevoked(bytes32 credentialId) external view returns (bool) {
        return _revoked[credentialId];
    }

    /**
     * @notice Returns the issuer address that registered a credential.
     *         Returns address(0) for unregistered credentials.
     * @param credentialId keccak256 of the VC's `jti` field
     */
    function issuerOf(bytes32 credentialId) external view returns (address) {
        return _issuers[credentialId];
    }
}
