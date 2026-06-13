import type { Wallet } from 'ethers';


/**
 * Core authentication and wallet information for a student.
 * Contains sensitive information that should be handled securely.
 */
export interface StudentEthWalletInfo {
    /** Unique identifier for the student, typically a student ID number. */
    readonly id: string;
    /** Authentication password. */
    readonly password: string;
    /** Ethereum wallet (EOA) instance for blockchain transactions. */
    readonly ethWallet: Wallet;
}

/**
 * Student authentication and academic wallet information.
 * Contains the credentials required for login and blockchain operations.
 */
export interface StudentCredentials extends Omit<StudentEthWalletInfo, "ethWallet"> {
    /** Ethereum address associated with the student's smart account. */
    readonly academicWalletAddress: string;
}

/**
 * Student on-chain identity data (EduWallet V3.0).
 *
 * Personal data (name, birthDate, etc.) has been removed from on-chain storage
 * and is now held exclusively in the student's KYC SD-JWT Verifiable Credential.
 * Only the DID hash remains on-chain for identity binding.
 */
export interface StudentData {
    /**
     * keccak256 of the student's did:key string.
     * Stored on-chain so the Student contract is linked to the SSI identity
     * without exposing the full DID or any personal data.
     */
    readonly didKeyHash: string;
}

/**
 * Student information including academic records.
 */
export interface Student extends StudentData {
    /** Collection of all academic results earned by the student. */
    readonly results?: AcademicResult[];
}

/**
 * Unique course identifier.
 * Used as the base for course-related interfaces.
 */
interface CourseId {
    /** Unique course identifier within the university system. */
    readonly code: string;
}

/**
 * Comprehensive academic record for a specific course.
 * Combines course information, evaluation details, and institutional context.
 */
export interface AcademicResult extends CourseInfo, Partial<Omit<Evaluation, "code">> {
    /** University where the course was taken. */
    readonly university: University;
}

/**
 * Detailed course information.
 * Contains descriptive data about a specific course.
 */
export interface CourseInfo extends CourseId {
    /** Full title of the course. */
    readonly name: string;
    /** Name of the degree program this course belongs to. */
    readonly degreeCourse: string;
    /** European Credit Transfer System credits awarded for completion. */
    readonly ects: number;
}

/**
 * Assessment details for a completed course.
 * Contains performance metrics and certification data.
 */
export interface Evaluation extends CourseId {
    /** Final grade achieved. */
    readonly grade: string;
    /** Date of evaluation in ISO format (YYYY-MM-DD). */
    readonly evaluationDate: string;
    /** Optional digital certificate or transcript file. */
    readonly certificate?: Buffer | string;
}

/**
 * Educational institution information.
 * Contains identifying details about a university.
 */
export interface University {
    /** Full official name of the university. */
    readonly name: string;
    /** Country where the university is located. */
    readonly country: string;
    /** Abbreviated name or acronym of the university. */
    readonly shortName: string;
}

/**
 * Represents permission types that can be granted to universities.
 */
export enum PermissionType {
    Read,
    Write,
}
