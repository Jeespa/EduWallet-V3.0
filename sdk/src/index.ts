import { ethers, type Wallet } from "ethers";
import type { CourseInfo, Evaluation, Student, StudentCredentials, StudentData } from "./types";
import type { Student as StudentContract } from '@typechain/contracts/Student';
import { PermissionType } from "./types";
import { computeDate, createStudentWallet, executeSmartAccountViewCall, generateStudent, getStudentContract, getStudentsRegister, getUniversityAccountAddress, publishCertificate, sendTransaction } from "./utils";
import { blockchainConfig, DEBUG, logError, provider, roleCodes } from "./conf";
import { deriveDidKey } from "./did";
import dayjs from "dayjs";
import utc from 'dayjs/plugin/utc.js';

/**
 * Re-export types for SDK consumers
 */
export type { StudentCredentials, StudentData, CourseInfo, Evaluation, Student}
export { PermissionType };

// DID utilities
export { deriveDidKey } from "./did";

// Configure dayjs to use UTC for consistent date handling across timezones
dayjs.extend(utc);

/**
 * Registers a new student in the academic blockchain system.
 *
 * EduWallet V3.0: personal data is no longer stored on-chain. The student's
 * did:key identifier is derived from their newly-created EOA key and its
 * keccak256 hash is stored on-chain as the identity binding.
 *
 * @param {Wallet} universityWallet - The university wallet with registration permissions
 * @returns {Promise<StudentCredentials>} The created student credentials and wallet information
 * @throws {Error} If university wallet is missing or registration fails
 */
export async function registerStudent(universityWallet: Wallet): Promise<StudentCredentials> {
    try {
        if (!universityWallet) {
            throw new Error('University wallet is required');
        }

        const studentsRegister = getStudentsRegister();

        // Create a new Ethereum wallet for the student
        const studentEthWallet = createStudentWallet();

        // Derive did:key from the EOA's secp256k1 public key, then hash it
        const compressedPubKey = new ethers.SigningKey(studentEthWallet.ethWallet.privateKey).compressedPublicKey;
        const did = deriveDidKey(compressedPubKey);
        const didKeyHash = ethers.keccak256(ethers.toUtf8Bytes(did));

        const connectedStudent = studentEthWallet.ethWallet.connect(provider);

        await sendTransaction(universityWallet, studentsRegister, blockchainConfig.registerAddress, 'registerStudent', [connectedStudent.address, didKeyHash]);

        const studentAccountAddress = await studentsRegister.connect(connectedStudent).getStudentAccount();

        return {
            id: studentEthWallet.id,
            password: studentEthWallet.password,
            academicWalletAddress: studentAccountAddress,
        }
    } catch (error) {
        logError('Failed to register student:', error)
        throw new Error('Failed to register student');
    }
}

/**
 * Enrolls a student in one or more academic courses.
 * Records course enrollments on the student's academic blockchain record, establishing the foundation for future evaluations.
 * @author Diego Da Giau
 * @param {Wallet} universityWallet - The university wallet with enrollment authority
 * @param {string} studentWalletAddress - The student's academic wallet address on blockchain
 * @param {CourseInfo[]} courses - Array of courses to enroll the student in (code, name, degreeCourse, ects)
 * @returns {Promise<void>} Promise that resolves when all enrollments are successfully recorded
 * @throws {Error} If university wallet is missing, student address is invalid, course data is invalid, or enrollment transaction fails
 */
export async function enrollStudent(universityWallet: Wallet, studentWalletAddress: string, courses: CourseInfo[]): Promise<void> {
    try {
        // Input validation
        if (!universityWallet) {
            throw new Error('University wallet is required');
        }

        if (!studentWalletAddress || !studentWalletAddress.startsWith('0x')) {
            throw new Error('Valid student wallet address is required');
        }

        if (!courses || !Array.isArray(courses) || courses.length === 0) {
            throw new Error('At least one course is required for enrollment');
        }

        // Validate course data
        courses.forEach((course, index) => {
            if (!course.code || !course.name || !course.degreeCourse || course.ects <= 0 || course.ects > 100) {
                throw new Error(`Invalid course data at index ${index}: all fields are required and ECTS must be positive and less than 100`);
            }
        });

        // Get student contract instance
        const studentWallet = getStudentContract(studentWalletAddress);

        // Connect university wallet to provider
        const connectedUniversity = universityWallet.connect(provider);

        const coursesInfo: StudentContract.EnrollmentInfoStruct[] = courses.map(c => {
            return {
                code: c.code,
                name: c.name,
                degreeCourse: c.degreeCourse,
                ects: c.ects*100,
            };
        });

        await sendTransaction(connectedUniversity, studentWallet, studentWalletAddress, 'enroll', [coursesInfo]);

    } catch (error) {
        logError('Enrollment process failed:', error);
        throw new Error('Student enrollment failed');
    }
}

/**
 * Records academic evaluations for a student's enrolled courses.
 * Publishes certificates to IPFS when provided and records evaluations on the blockchain.
 * @author Diego Da Giau
 * @param {Wallet} universityWallet - The university wallet with evaluation permissions
 * @param {string} studentWalletAddress - The student's academic wallet address
 * @param {Evaluation[]} evaluations - Array of academic evaluations to record
 * @returns {Promise<void>} Promise that resolves when all evaluations are successfully recorded
 * @throws {Error} If university wallet is missing, student address is invalid, evaluation data is invalid, or the evaluation transaction fails
 */
export async function evaluateStudent(universityWallet: Wallet, studentWalletAddress: string, evaluations: Evaluation[]): Promise<void> {
    try {
        // Input validation
        if (!universityWallet) {
            throw new Error('University wallet is required');
        }

        if (!studentWalletAddress || !studentWalletAddress.startsWith('0x')) {
            throw new Error('Valid student wallet address is required');
        }

        if (!evaluations || !Array.isArray(evaluations) || evaluations.length === 0) {
            throw new Error('At least one evaluation is required');
        }

        // Validate evaluation data
        evaluations.forEach((evaluation, index) => {
            if (!evaluation.code) {
                throw new Error(`Evaluation at index ${index} missing required field: code`);
            }
            if (!evaluation.grade) {
                throw new Error(`Evaluation at index ${index} has invalid grade: ${evaluation.grade}`);
            }
            if (!evaluation.evaluationDate) {
                throw new Error(`Evaluation at index ${index} missing required field: evaluationDate`);
            }
            if (new Date(evaluation.evaluationDate) <= new Date('1970-01-01')) {
                throw new Error('Student birthdate is incompatible - the date must be after 1970-01-01')
            }
        });

        // Get student contract instance
        const studentWallet = getStudentContract(studentWalletAddress);

        // Connect university wallet to provider with NonceManager
        const connectedUniversity = universityWallet.connect(provider);

        const contractEvaluations: StudentContract.EvaluationInfoStruct[] = [];

        for (const evaluation of evaluations) {
            // Publish certificate to IPFS if provided
            let certificate = '';
            if (evaluation.certificate) {
                try {
                    certificate = await publishCertificate(evaluation.certificate);
                } catch (certError) {
                    logError(`Failed to publish certificate for course ${evaluation.code}:`, certError);
                    throw certError;
                }
            }
            contractEvaluations.push({
                code: evaluation.code,
                grade: evaluation.grade,
                date: dayjs.utc(evaluation.evaluationDate).unix(),
                certificateHash: certificate
            });
        }

        await sendTransaction(connectedUniversity, studentWallet, studentWalletAddress, 'evaluate', [contractEvaluations]);
    } catch (error) {
        logError('Evaluation process failed:', error);
        throw new Error('Student evaluation failed');
    }
}

/**
 * Retrieves student on-chain identity data.
 *
 * EduWallet V3.0: personal data is no longer on-chain. This function returns
 * the student's `didKeyHash` from the public contract getter.
 * Use `getStudentWithResult` to also include academic results.
 *
 * @param {Wallet} universityWallet - The university wallet (unused for public getter, kept for API consistency)
 * @param {string} studentWalletAddress - The student's academic wallet address
 * @returns {Promise<Student>} The student's on-chain identity data
 */
export async function getStudentInfo(_universityWallet: Wallet, studentWalletAddress: string): Promise<Student> {
    try {
        if (!studentWalletAddress || !studentWalletAddress.startsWith('0x')) {
            throw new Error('Valid student wallet address is required');
        }

        const studentContract = getStudentContract(studentWalletAddress);
        const didKeyHash: string = await (studentContract as any).didKeyHash();

        if (DEBUG) {
            console.log('Student didKeyHash:', didKeyHash);
        }

        return { didKeyHash };
    } catch (error) {
        logError('Failed to retrieve student information:', error);
        throw new Error('Failed to retrieve student information');
    }
}

/**
 * Retrieves student information including academic results.
 *
 * Fetches both the on-chain `didKeyHash` and the full list of academic results
 * the university has permission to see.
 *
 * @param {Wallet} universityWallet - The university wallet with READER or WRITER role
 * @param {string} studentWalletAddress - The student's academic wallet address
 * @returns {Promise<Student>} Student with didKeyHash and academic results
 * @throws {Error} If university wallet is missing, student address is invalid, or data retrieval fails
 */
export async function getStudentWithResult(universityWallet: Wallet, studentWalletAddress: string): Promise<Student> {
    try {
        if (!universityWallet) {
            throw new Error('University wallet is required');
        }
        if (!studentWalletAddress || !studentWalletAddress.startsWith('0x')) {
            throw new Error('Valid student wallet address is required');
        }

        const studentAccount = getStudentContract(studentWalletAddress);
        const connectedUniversity = universityWallet.connect(provider);

        const [student, results] = await Promise.all([
            getStudentInfo(universityWallet, studentWalletAddress),
            executeSmartAccountViewCall(connectedUniversity, studentAccount, studentWalletAddress, 'getResults', []),
        ]);

        return await generateStudent(student, results[0]);
    } catch (error) {
        logError('Failed to retrieve complete student information:', error);
        throw new Error('Failed to retrieve complete student information');
    }
}

/**
 * Requests permission to access a student's academic wallet.
 * Universities must request access before they can read or modify student records.
 * @author Diego Da Giau
 * @param {Wallet} universityWallet - The university wallet requesting permission
 * @param {string} studentWalletAddress - The student's academic wallet address
 * @param {PermissionType} type - Type of permission requested (Read or Write)
 * @returns {Promise<void>} Promise that resolves when the permission request is submitted and confirmed
 * @throws {Error} If university wallet is missing, student address is invalid, permission type is invalid, or permission request fails
 */
export async function askForPermission(universityWallet: Wallet, studentWalletAddress: string, type: PermissionType): Promise<void> {
    try {
        // Input validation
        if (!universityWallet) {
            throw new Error('University wallet is required');
        }

        if (!studentWalletAddress || !studentWalletAddress.startsWith('0x')) {
            throw new Error('Valid student wallet address is required');
        }

        if (type !== PermissionType.Read && type !== PermissionType.Write) {
            throw new Error(`Invalid permission type: ${type}. Must be Read or Write.`);
        }

        // Get student contract instance
        const studentWallet = getStudentContract(studentWalletAddress);

        // Connect university wallet to provider
        const connectedUniversity = universityWallet.connect(provider);

        // Determine the permission code based on requested type
        const permission = type === PermissionType.Read ? roleCodes.readRequest : roleCodes.writeRequest;

        await sendTransaction(connectedUniversity, studentWallet, studentWalletAddress, 'askForPermission', [permission]);
    } catch (error) {
        logError('Failed to request permission:', error);
        throw new Error('Failed to request permission');
    }
}

/**
 * Verifies a university's permission level for a student's academic wallet.
 * @author Diego Da Giau
 * @param {Wallet} universityWallet - The university wallet to check permissions for
 * @param {string} studentWalletAddress - The student's academic wallet address
 * @returns {Promise<PermissionType | null>} The highest permission level (Read or Write) or null if no permission
 * @throws {Error} If university wallet is missing, student address is invalid, or permission verification fails
 */
export async function verifyPermission(universityWallet: Wallet, studentWalletAddress: string): Promise<PermissionType | null> {
    try {
        // Input validation
        if (!universityWallet) {
            throw new Error('University wallet is required');
        }

        if (!studentWalletAddress || !studentWalletAddress.startsWith('0x')) {
            throw new Error('Valid student wallet address is required');
        }

        // Get student contract instance
        const studentWallet = getStudentContract(studentWalletAddress);

        // Connect university wallet to provider
        const connectedUniversity = universityWallet.connect(provider);

        // Check permission level on blockchain
        const [permission] = await executeSmartAccountViewCall(connectedUniversity, studentWallet, studentWalletAddress, 'verifyPermission', []);

        // Map permission code to PermissionType enum
        if (permission === roleCodes.read) {
            return PermissionType.Read;
        } else if (permission === roleCodes.write) {
            return PermissionType.Write;
        }

        // If no permission, return null
        return null;
    } catch (error) {
        logError('Failed to verify permission:', error);
        throw new Error('Failed to verify permission');
    }
}
