// SPDX-License-Identifier: GPL-3.0

pragma solidity >=0.8.2;

import {AccessControlEnumerable} from "@openzeppelin/contracts/access/extensions/AccessControlEnumerable.sol";
import {SmartAccount} from "./SmartAccount.sol";
import {IEntryPoint} from "@account-abstraction/contracts/interfaces/IEntryPoint.sol";

// Custom errors for better clarity
error WrongRole();
error PermissionAlreadyGiven();

/**
 * @title Student Smart Contract
 * @author Diego Da Giau, extended for EduWallet V3.0
 * @notice Manages a student's academic records and university permissions.
 *         Personal data (name, birthDate, etc.) has been removed from on-chain
 *         storage and is now held exclusively in Verifiable Credentials (SD-JWTs)
 *         stored in the student's mobile wallet.
 * @dev Implements role-based access control for universities to manage student records
 */
contract Student is SmartAccount, AccessControlEnumerable {
    // Role definitions for access control
    bytes32 private constant READER_ROLE = keccak256("READER_ROLE");
    bytes32 private constant WRITER_ROLE = keccak256("WRITER_ROLE");

    // Role definition for access requests control
    bytes32 private constant READER_APPLICANT = keccak256("READER_APPLICANT");
    bytes32 private constant WRITER_APPLICANT = keccak256("WRITER_APPLICANT");

    /**
     * @dev Represents enrollment information for a course
     * @param code Course code
     * @param name Course name
     * @param degreeCourse Name of the degree program
     * @param ects ECTS credits for the course
     */
    struct EnrollmentInfo {
        string code;
        string name;
        string degreeCourse;
        uint16 ects;
    }

    /**
     * @dev Represents evaluation information for a completed course
     * @param code Course code to identify which course is being evaluated
     * @param grade Final grade assigned to the student
     * @param date Unix timestamp when the grade was assigned
     * @param certificateHash CID of the IPFS file representing the certificate
     */
    struct EvaluationInfo {
        string code;
        string grade;
        uint date;
        string certificateHash;
    }

    /**
     * @dev Represents an academic result/course enrollment
     * @param code Course code
     * @param name Course name
     * @param university Address of the university that created the record
     * @param degreeCourse Name of the degree program
     * @param ects ECTS credits for the course (original value multiplied by 100 to work with integer numbers)
     * @param grade Final grade (empty if not evaluated)
     * @param date Date when the grade was assigned
     * @param certificateHash CID of the IPFS file representing the certificate
     */
    struct Result {
        string code;
        string name;
        address university;
        string degreeCourse;
        uint16 ects;
        string grade;
        uint date;
        string certificateHash;
    }

    /**
     * @notice keccak256 hash of the student's did:key identifier.
     *         Used for off-chain DID lookups without storing the full DID string.
     */
    bytes32 public didKeyHash;

    // On-chain academic record — no personal data
    Result[] private _results;

    /**
     * @notice Creates a new Student contract
     * @dev Grants initial roles and records the DID hash for identity binding
     * @param _university Initial university address to receive WRITER_ROLE
     * @param _student Student's EOA address (owner)
     * @param _didKeyHash keccak256 of the student's did:key string
     * @param _entryPoint EntryPoint contract address for account abstraction
     */
    constructor(
        address _university,
        address _student,
        bytes32 _didKeyHash,
        IEntryPoint _entryPoint
    ) SmartAccount(_entryPoint, _student) {
        didKeyHash = _didKeyHash;
        _grantRole(DEFAULT_ADMIN_ROLE, address(this));
        _grantRole(WRITER_ROLE, _university);
    }

    /**
     * @notice Returns all academic results for the student.
     * @dev Only accessible by the student (DEFAULT_ADMIN_ROLE via executeViewCall).
     *      Personal data is no longer stored on-chain — see the student's KYC VC.
     * @return Array of all academic results
     */
    function getStudentInfo()
        external
        view
        onlyRole(DEFAULT_ADMIN_ROLE)
        returns (Result[] memory)
    {
        return _results;
    }

    /**
     * @notice Gets all academic results
     * @dev Only accessible by addresses with READER_ROLE or WRITER_ROLE
     * @return Array of academic results
     */
    function getResults() external view returns (Result[] memory) {
        require(
            hasRole(READER_ROLE, _msgSender()) ||
                hasRole(WRITER_ROLE, _msgSender()),
            AccessControlUnauthorizedAccount(_msgSender(), READER_ROLE)
        );
        return _results;
    }

    /**
     * @notice Enrolls a student in one or more courses
     * @dev Only callable by universities with WRITER_ROLE.
     * @param _enrollments Array of enrollment information for each course
     */
    function enroll(
        EnrollmentInfo[] calldata _enrollments
    ) external onlyRole(WRITER_ROLE) {
        for (uint i = 0; i < _enrollments.length; ++i) {
            Result memory r = Result(
                _enrollments[i].code,
                _enrollments[i].name,
                _msgSender(),
                _enrollments[i].degreeCourse,
                _enrollments[i].ects,
                "",
                0,
                ""
            );
            _results.push(r);
        }
    }

    /**
     * @notice Updates course records with evaluation results (grades and certificates)
     * @dev Only callable by universities with WRITER_ROLE.
     * @param _evaluations Array of evaluation information for completed courses
     */
    function evaluate(
        EvaluationInfo[] calldata _evaluations
    ) external onlyRole(WRITER_ROLE) {
        for (uint i = 0; i < _evaluations.length; ++i) {
            for (uint j; j < _results.length; ++j) {
                if (
                    keccak256(bytes(_results[j].code)) ==
                    keccak256(bytes(_evaluations[i].code)) &&
                    _results[j].university == _msgSender()
                ) {
                    _results[j].grade = _evaluations[i].grade;
                    _results[j].date = _evaluations[i].date;
                    _results[j].certificateHash = _evaluations[i].certificateHash;
                    break;
                }
            }
        }
    }

    /**
     * @notice Allows a university to request permission to access student data
     * @dev University addresses will be added to READER_APPLICANT or WRITER_APPLICANT roles
     * @param _permissionType Permission type requested (READER_APPLICANT or WRITER_APPLICANT)
     */
    function askForPermission(bytes32 _permissionType) external {
        // Validate permission type
        if (
            _permissionType != READER_APPLICANT &&
            _permissionType != WRITER_APPLICANT
        ) {
            revert WrongRole();
        }

        // Check if already has the same or higher permission
        if (
            (_permissionType == READER_APPLICANT &&
                hasRole(READER_ROLE, _msgSender())) ||
            (hasRole(WRITER_ROLE, _msgSender()))
        ) {
            revert PermissionAlreadyGiven();
        }

        // Check if already applied for same or higher permission
        if (
            (_permissionType == READER_APPLICANT &&
                hasRole(READER_APPLICANT, _msgSender())) ||
            (hasRole(WRITER_APPLICANT, _msgSender()))
        ) {
            // Already applied, nothing to do
            return;
        }

        // Remove lower level applications if applying for write permission
        if (
            _permissionType == WRITER_APPLICANT &&
            hasRole(READER_APPLICANT, _msgSender())
        ) {
            revokeRole(READER_APPLICANT, _msgSender());
        }

        // Grant the requested applicant role
        _grantRole(_permissionType, _msgSender());
    }

    /**
     * @notice Grants permission to a university
     * @dev Only callable by the student (DEFAULT_ADMIN_ROLE)
     * @param _permissionType Permission type (READER_ROLE or WRITER_ROLE)
     * @param _university Address of university to grant permission to
     */
    function grantPermission(
        bytes32 _permissionType,
        address _university
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        // Check if the permission exists
        if (_permissionType != WRITER_ROLE && _permissionType != READER_ROLE) {
            revert WrongRole();
        }

        // Grant the requested permission
        grantRole(_permissionType, _university);

        // Remove lower permission if granting higher one, or vice versa
        // (a university shouldn't have both read and write permissions simultaneously)
        if (
            _permissionType == WRITER_ROLE && hasRole(READER_ROLE, _university)
        ) {
            revokeRole(READER_ROLE, _university);
        } else if (
            _permissionType == READER_ROLE && hasRole(WRITER_ROLE, _university)
        ) {
            revokeRole(WRITER_ROLE, _university);
        }

        // Remove the university from the applicants list if present
        if (hasRole(WRITER_APPLICANT, _university)) {
            revokeRole(WRITER_APPLICANT, _university);
        } else if (hasRole(READER_APPLICANT, _university)) {
            revokeRole(READER_APPLICANT, _university);
        }
    }

    /**
     * @notice Revokes all permissions from a university
     * @dev Only callable by the student (DEFAULT_ADMIN_ROLE)
     * @param _university Address of university to revoke permissions from
     */
    function revokePermission(
        address _university
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (hasRole(WRITER_ROLE, _university)) {
            revokeRole(WRITER_ROLE, _university);
        } else {
            revokeRole(READER_ROLE, _university);
        }
    }

    /**
     * @notice Lists all universities with a specific permission type
     * @dev Only callable by the student (DEFAULT_ADMIN_ROLE)
     * @param _permissionType Permission type to query (READER_ROLE or WRITER_ROLE)
     * @return Array of university addresses with specified permission
     */
    function getPermissions(
        bytes32 _permissionType
    ) external view onlyRole(DEFAULT_ADMIN_ROLE) returns (address[] memory) {
        // Check if the permission exists
        require(
            _permissionType == WRITER_ROLE ||
                _permissionType == READER_ROLE ||
                _permissionType == READER_APPLICANT ||
                _permissionType == WRITER_APPLICANT,
            WrongRole()
        );
        return getRoleMembers(_permissionType);
    }

    /**
     * @notice Verifies the caller's highest permission level for this student wallet
     * @dev Returns the highest permission role the caller has, with WRITER_ROLE taking precedence over READER_ROLE
     * @return bytes32 The highest permission role (WRITER_ROLE, READER_ROLE, or bytes32(0) if no permission)
     */
    function verifyPermission() external view returns (bytes32) {
        // Check for write permission first (highest privilege)
        if (hasRole(WRITER_ROLE, _msgSender())) {
            return WRITER_ROLE;
        }
        // Then check for read permission
        if (hasRole(READER_ROLE, _msgSender())) {
            return READER_ROLE;
        }
        // Return bytes32(0) if no permission
        return bytes32(0);
    }
}
