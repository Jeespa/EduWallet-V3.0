import { JsonRpcProvider, Wallet, NonceManager, parseEther } from 'ethers';
import { randomBytes, pbkdf2Sync } from 'node:crypto';
import type { Paymaster, StudentDeployer, StudentsRegister, UniversityDeployer } from '@typechain/contracts';
import { StudentsRegister__factory } from "@typechain/factories/contracts/StudentsRegister__factory"
import { StudentDeployer__factory } from '@typechain/factories/contracts/StudentDeployer__factory';
import { UniversityDeployer__factory } from '@typechain/factories/contracts/UniversityDeployer__factory';
import { EntryPoint__factory } from '@typechain/factories/@account-abstraction/contracts/core/EntryPoint__factory';
import { Paymaster__factory } from '@typechain/factories/contracts/Paymaster__factory';
import { VCStatusRegistry__factory } from '@typechain/factories/contracts/VCStatusRegistry__factory';
import type { EntryPoint } from '@typechain/@account-abstraction/contracts/core/EntryPoint';
import * as eduwallet from 'eduwallet-sdk';
import * as dotenv from 'dotenv';


/**
 * Load environment variables from .env file
 */
dotenv.config();
const VERBOSE = process.env.VERBOSE || false;

// Initialize provider with the RPC URL from environment or use localhost as fallback
const PROVIDER = new JsonRpcProvider(process.env.RPC_URL || "http://localhost:8545");


// Core contract references used throughout the application.
// These get initialized during deployment process
const deployer = getDeployer();
let entryP: EntryPoint | undefined;        // EntryPoint contract for account abstraction
let studentsRegister: StudentsRegister | undefined;  // Main registry contract 
export let uni: Wallet | undefined;        // Active university wallet

/**
 * Retrieves the deployer wallet using the private key from environment variables.
 * This wallet is used for initial contract deployment and funding operations.
 * @author Diego Da Giau
 * @returns {Wallet} The deployer wallet connected to the provider
 * @throws {Error} If the deployer private key is not found in environment variables
 */
function getDeployer(): Wallet {
    const deployerPrivateKey = process.env.DEPLOYER_PRIVATE_KEY;
    if (!deployerPrivateKey) {
        throw new Error("Deployer private key not found in environment variables");
    }
    const deployer = new Wallet(deployerPrivateKey, PROVIDER);

    if (VERBOSE) {
        console.log(`---------------------------------------------------`);
        console.log(`DEPLOYER:`);
        console.log(`Address: ${deployer.address}`)
        console.log(`---------------------------------------------------`);
    }

    return deployer;
}

/**
 * Deploys the complete contract infrastructure for the EduWallet system:
 * 1. EntryPoint - Core account abstraction component
 * 2. StudentDeployer & UniversityDeployer - Factory contracts for creating user accounts
 * 3. StudentsRegister - Main registry that tracks all universities and students
 * 4. Paymaster - Handles gas fee sponsorship for users
 * All contracts are deployed in parallel where possible to optimize deployment time.
 * @returns {Promise<void>} Promise that resolves when all contracts are successfully deployed
 * @throws {Error} If any deployment step fails
 */
export async function deployStudentsRegister(): Promise<void> {
    try {
        // Create a managed deployer to handle transaction nonces
        const managedDeployer = new NonceManager(deployer);

        // Deploy core contracts in parallel
        const [entryPoint, studentDeployer, universityDeployer] = await deployInfrastructureContracts(managedDeployer);

        // Store EntryPoint reference globally for later use
        entryP = entryPoint;

        // Deploy registry and paymaster contracts
        const [register, paymaster] = await deployApplicationContracts(
            managedDeployer,
            entryPoint,
            studentDeployer,
            universityDeployer
        );

        // Fund the paymaster with ETH to cover user operations
        await fundPaymaster(entryPoint, paymaster);

        // Log deployment information if verbose mode is enabled
        if (VERBOSE) {
            logDeploymentAddresses(
                await entryPoint.getAddress(),
                await studentDeployer.getAddress(),
                await universityDeployer.getAddress(),
                await paymaster.getAddress(),
                await register.getAddress()
            );
        }

        // Store reference to register for subsequent operations
        studentsRegister = register;

        // Deploy VCStatusRegistry
        const vcRegistryFactory = new VCStatusRegistry__factory(managedDeployer);
        const vcRegistry = await vcRegistryFactory.deploy();
        await vcRegistry.waitForDeployment();
        const vcRegistryAddress = await vcRegistry.getAddress();
        const studentDeployerAddress = await studentDeployer.getAddress();

        console.log(`\n---------------------------------------------------`);
        console.log(`VC STATUS REGISTRY:`);
        console.log(`Address: ${vcRegistryAddress}`);
        console.log(`\nSTUDENT DEPLOYER:`);
        console.log(`Address: ${studentDeployerAddress}`);
        console.log(`\nAdd to gateway/.env:`);
        console.log(`VC_STATUS_REGISTRY_ADDRESS=${vcRegistryAddress}`);
        console.log(`STUDENT_DEPLOYER_ADDRESS=${studentDeployerAddress}`);
        console.log(`---------------------------------------------------\n`);
    } catch (error) {
        throw new Error(`Deployment failed: ${error}`);
    }
}

/**
 * Deploys the core infrastructure contracts required by the EduWallet system:
 * - EntryPoint: Core contract that processes user operations without requiring gas
 * - StudentDeployer: Factory that creates deterministic student smart accounts
 * - UniversityDeployer: Factory that creates university smart accounts
 * @param deployer - NonceManager instance that handles transaction ordering
 * @returns {Promise<[EntryPoint, StudentDeployer, UniversityDeployer]>} Triple of deployed contract instances
 */
async function deployInfrastructureContracts(deployer: NonceManager): Promise<[EntryPoint, StudentDeployer, UniversityDeployer]> {
    // Deploy EntryPoint contract using TypeChain factory
    const entryPointFactory = new EntryPoint__factory(deployer);
    const entryPoint = await entryPointFactory.deploy();

    // Deploy StudentDeployer contract using TypeChain factory
    const studentDeployerFactory = new StudentDeployer__factory(deployer);
    const studentDeployer = await studentDeployerFactory.deploy();

    // Deploy UniversityDeployer contract using TypeChain factory
    const universityDeployerFactory = new UniversityDeployer__factory(deployer);
    const universityDeployer = await universityDeployerFactory.deploy();

    // Wait for deployments to be mined
    await Promise.all([
        entryPoint.waitForDeployment(),
        studentDeployer.waitForDeployment(),
        universityDeployer.waitForDeployment()
    ]);

    return [entryPoint, studentDeployer, universityDeployer];
}

/**
 * Deploys the application-specific contracts for the EduWallet system:
 * - StudentsRegister: Central registry that manages university and student accounts
 * - Paymaster: Contract that sponsors gas fees for users of the system
 * @param deployer - NonceManager instance that handles transaction ordering
 * @param entryPoint - Deployed EntryPoint contract instance
 * @param studentDeployer - Deployed StudentDeployer contract instance
 * @param universityDeployer - Deployed UniversityDeployer contract instance
 * @returns {Promise<[StudentsRegister, Paymaster]>} Pair of deployed contract instances
 */
async function deployApplicationContracts(
    deployer: NonceManager,
    entryPoint: EntryPoint,
    studentDeployer: any,
    universityDeployer: any
): Promise<[StudentsRegister, Paymaster]> {
    // Get deployed contract addresses
    const [entryPointAddress, studentDeployerAddress, universityDeployerAddress] =
        await Promise.all([
            entryPoint.getAddress(),
            studentDeployer.getAddress(),
            universityDeployer.getAddress()
        ]);

    // Deploy StudentsRegister contract using TypeChain factory
    const studentsRegisterFactory = new StudentsRegister__factory(deployer);
    const register = await studentsRegisterFactory.deploy(studentDeployerAddress, universityDeployerAddress, entryPoint);

    // Deploy Paymaster contract using TypeChain factory
    const paymasterFactory = new Paymaster__factory(deployer);
    const paymaster = await paymasterFactory.deploy(entryPointAddress);

    // Wait for deployments to be mined
    await Promise.all([
        register.waitForDeployment(),
        paymaster.waitForDeployment()
    ]);

    return [register, paymaster];
}

/**
 * Funds the paymaster contract with ETH to cover gas fees for users.
 * @param entryPoint - EntryPoint contract that will hold the deposit
 * @param paymaster - Paymaster contract that will use the deposit
 * @returns {Promise<void>} Promise that resolves when funding is complete
 */
async function fundPaymaster(entryPoint: EntryPoint, paymaster: any): Promise<void> {
    const paymasterAddress = await paymaster.getAddress();

    // Deposit 1M ETH to the paymaster (this is for testing purposes)
    const tx = await entryPoint.depositTo(paymasterAddress, {
        value: parseEther("1000000")
    });

    // Wait for transaction confirmation
    await tx.wait();
}

/**
 * Logs the addresses of all deployed contracts to the console.
 * @param entryPointAddress - Address of the EntryPoint contract
 * @param studentDeployerAddress - Address of the StudentDeployer contract
 * @param universityDeployerAddress - Address of the UniversityDeployer contract
 * @param paymasterAddress - Address of the Paymaster contract
 * @param studentsRegisterAddress - Address of the StudentsRegister contract
 */
function logDeploymentAddresses(
    entryPointAddress: string,
    studentDeployerAddress: string,
    universityDeployerAddress: string,
    paymasterAddress: string,
    studentsRegisterAddress: string
): void {
    console.log(`\n---------------------------------------------------`);
    console.log(`ENTRY POINT:`);
    console.log(`Address: ${entryPointAddress}`);
    console.log(`---------------------------------------------------`);
    console.log(`STUDENT DEPLOYER:`);
    console.log(`Address: ${studentDeployerAddress}`);
    console.log(`---------------------------------------------------`);
    console.log(`UNIVERSITY DEPLOYER:`);
    console.log(`Address: ${universityDeployerAddress}`);
    console.log(`---------------------------------------------------`);
    console.log(`PAYMASTER:`);
    console.log(`Address: ${paymasterAddress}`);
    console.log(`---------------------------------------------------`);
    console.log(`STUDENT REGISTER:`);
    console.log(`Address: ${studentsRegisterAddress}`);
    console.log(`---------------------------------------------------\n`);
}

/**
 * Creates a new university.
 * Generates a random private key and connects the wallet with the provider.
 * @author Diego Da Giau
 * @returns {Wallet} The university wallet connected to the system provider
 * @throws {Error} If wallet creation fails, with the error message from the underlying error
 */
function getUniversityWallet(): Wallet {
    try {
        // Generate a random private key for the university
        const privateKey = randomBytes(32).toString('hex');
        const universityPrivateKey = `0x${privateKey}`;
        const wallet = new Wallet(universityPrivateKey, PROVIDER);

        // Display university credentials
        console.log(`\n---------------------------------------------------`);
        console.log(`UNIVERSITY:`);
        console.log(`Private key: ${universityPrivateKey}`);
        if (VERBOSE) {
            console.log(`Address: ${wallet.address}`)
        }
        console.log(`---------------------------------------------------\n`);

        return wallet;
    } catch (error) {
        throw new Error(`${error}`);
    }
}

/**
 * Registers a new university in the academic blockchain system.
 * Creates a university wallet, funds it, and subscribes it to the system.
 * @author Diego Da Giau
 * @param {string} name - The university's full name
 * @param {string} country - The university's country
 * @param {string} shortName - The university's abbreviated name
 * @returns {Promise<void>} Promise that resolves when the university is successfully subscribed
 * @throws {Error} If the students register contract is not deployed or if any part of the subscription process fails, with the error message from the underlying error
 */
export async function subscribeUniversity(name: string, country: string, shortName: string): Promise<void> {
    if (!studentsRegister) {
        throw new Error("Students register not deployed - run deployStudentsRegister first");
    }

    if (!entryP) {
        throw new Error("Entry point not deployed - run deployStudentsRegister first");
    }

    try {
        // Store the university wallet for future operations
        uni = getUniversityWallet();

        const managedDeployer = new NonceManager(deployer);

        const fundTx = await managedDeployer.sendTransaction({
            to: uni.address,
            value: parseEther('10000'),
        });

        // Subscribe the university to the register
        const universityTx = await studentsRegister.connect(managedDeployer).subscribe(
            uni.address,
            name,
            country,
            shortName
        );

        // Wait for the transactions to be confirmed
        await Promise.all([
            universityTx.wait(),
            fundTx.wait()
        ]);

        // Retrieve the university SCA address for gateway configuration
        const uniSca = await studentsRegister.connect(uni).getUniversityAccount();
        console.log(`\n---------------------------------------------------`);
        console.log(`UNIVERSITY SCA:`);
        console.log(`Private key (EOA): ${uni.privateKey}`);
        console.log(`SCA address:       ${uniSca}`);
        console.log(`\nAdd to gateway/.env:`);
        console.log(`GATEWAY_UNIVERSITY_PRIVATE_KEY=${uni.privateKey}`);
        console.log(`GATEWAY_UNIVERSITY_SCA=${uniSca}`);
        console.log(`---------------------------------------------------\n`);
    } catch (error) {
        throw new Error(`${error}`);
    }
}

/**
 * Registers a new student in the academic blockchain system (EduWallet V3.0).
 *
 * Personal data is no longer stored on-chain. The SDK derives the student's
 * did:key from their newly-created EOA and stores only the keccak256 hash.
 *
 * @returns {Promise<void>} Promise that resolves when the student is successfully registered
 * @throws {Error} If no university wallet is available or registration fails
 */
export async function registerStudent(): Promise<void> {
    if (!uni) {
        throw new Error("University not present")
    }
    try {
        const student = await eduwallet.registerStudent(uni);

        // Fund student's ETH wallet
        const studentEthWallet = await getStudentWallet(student.id, student.password);

        const fundTx = await deployer.sendTransaction({
            to: studentEthWallet.address,
            value: parseEther('10000'),
        });

        await fundTx.wait();

        console.log(`\n---------------------------------------------------`);
        console.log(`STUDENT:`);
        console.log(`Wallet address: ${student.academicWalletAddress}`);
        console.log(`Id: ${student.id}`);
        console.log(`Password: ${student.password}`);
        console.log(`(Personal data is held in the student's KYC VC, not on-chain)`);
        console.log(`---------------------------------------------------\n`);
    } catch (error) {
        throw new Error(`${error}`);
    }
}

/**
 * Creates a student wallet using deterministic key derivation from credentials.
 * Uses the student ID and password to derive a consistent private key.
 * @author Diego Da Giau
 * @param {string} id - The student's unique identifier, used as salt in key derivation
 * @param {string} password - The student's password for key derivation
 * @returns {Promise<Wallet>} Ethereum wallet instance connected to the provider
 * @throws {Error} If credentials are missing or key derivation fails
 */
export async function getStudentWallet(id: string, password: string): Promise<Wallet> {
    try {
        if (!password || !id) {
            throw new Error('Invalid credentials: Missing password or ID');
        }
        const privateKey = derivePrivateKey(password, id);
        return new Wallet(privateKey);
    } catch (error) {
        throw new Error('Could not create student wallet from credentials');
    }
}

/**
 * Derives a deterministic private key from a password and student ID using PBKDF2.
 * This creates a reproducible key that can be reconstructed with the same inputs,
 * allowing students to access their wallets consistently across sessions.
 * @author Diego Da Giau
 * @param {string} password - User password for key derivation
 * @param {string} studentId - Student ID used as salt in the derivation process
 * @returns {string} Ethereum-compatible private key with 0x prefix
 * @throws {Error} If the key derivation process fails
 */
function derivePrivateKey(password: string, studentId: string): string {
    try {
        // Number of PBKDF2 iterations for security
        const iterations = 100000;

        // 32 bytes = 256 bits for Ethereum compatibility
        const keyLength = 32;

        const derivedKey = pbkdf2Sync(password, studentId, iterations, keyLength, 'sha256').toString('hex');
        // Add Ethereum hex prefix
        return '0x' + derivedKey;
    } catch (error) {
        throw new Error('Failed to derive private key: ' + (error instanceof Error ? error.message : String(error)));
    }
}

/**
 * Retrieves student on-chain identity data (EduWallet V3.0).
 *
 * Personal data is no longer on-chain — it lives in the student's KYC SD-JWT VC.
 * This function shows the DID hash and prompts the caller to check academic results
 * via getStudentInfoResults.
 *
 * @param {string} studentWallet - The student's academic wallet address
 */
export async function getStudentInfo(studentWallet: string): Promise<void> {
    if (!uni) {
        throw new Error("University not present - subscribe a university first");
    }

    try {
        const studentData = await eduwallet.getStudentInfo(uni, studentWallet);

        console.log(`---------------------------------------------------`);
        console.log(`STUDENT (on-chain identity):`);
        console.log(`DID key hash: ${studentData.didKeyHash}`);
        console.log(`(Personal data is held in the student's KYC VC — not on-chain)`);
        console.log(`---------------------------------------------------`);
    } catch (error) {
        throw new Error(`${error}`);
    }
}

/**
 * Retrieves student information including academic results.
 * Provides a complete academic profile with course outcomes.
 * @author Diego Da Giau
 * @param {string} studentWallet - The student's academic wallet address
 * @returns {Promise<void>} Promise that resolves when student information and results are successfully retrieved
 * @throws {Error} If no university wallet is available for retrieval or if the retrieval process fails, with the error message from the underlying error
 */
export async function getStudentInfoResults(studentWallet: string): Promise<void> {
    if (!uni) {
        throw new Error("University not present - subscribe a university first");
    }

    try {
        // Retrieve complete student information with results using the SDK
        const studentComplete = await eduwallet.getStudentWithResult(uni, studentWallet);

        // Display academic results (personal data is in the student's KYC VC)
        console.log(`\n---------------------------------------------------`);
        console.log(`STUDENT (academic record):`);
        console.log(`DID key hash: ${studentComplete.didKeyHash}`);
        console.log(`(Personal data held in student's KYC VC — not on-chain)`);
        console.log(`Results:`);

        // Iterate through and display each academic result
        for (const result of studentComplete.results ?? []) {
            console.log(`\tCourse Code: ${result.code}`);
            console.log(`\tCourse Name: ${result.name}`);
            console.log(`\tUniversity: ${result.university.name}`);
            console.log(`\tDegree course: ${result.degreeCourse}`);
            console.log(`\tECTS: ${result.ects || "N/A"}`);
            console.log(`\tDate: ${result.evaluationDate ? result.evaluationDate : "N/A"}`);
            console.log(`\tGrade: ${result.grade || "N/A"}`);
            console.log(`\tCertificate: ${result.certificate || "N/A"}\n`);
        }
        console.log(`---------------------------------------------------\n`);
    } catch (error) {
        throw new Error(`${error}`);
    }
}

/**
 * Enrolls a student in one or more academic courses.
 * Submits enrollment transactions to the blockchain.
 * @author Diego Da Giau
 * @param {string} studentWallet - The student's academic wallet address
 * @param {eduwallet.CourseInfo[]} courses - Array of courses to enroll the student in
 * @returns {Promise<void>} Promise that resolves when the student is successfully enrolled in all courses
 * @throws {Error} If no university wallet is available for enrollment, if any enrollments fail, or if the enrollment process encounters an error, with the error message from the underlying error
 */
export async function enrollStudent(studentWallet: string, courses: eduwallet.CourseInfo[]): Promise<void> {
    if (!uni) {
        throw new Error("University not present - subscribe a university first");
    }

    try {
        if (VERBOSE) {
            console.log("\nEnrolling student...");
        }

        // Use the SDK to enroll the student in the courses
        await eduwallet.enrollStudent(uni, studentWallet, courses);
    } catch (error) {
        throw new Error(`${error}`);
    }
}

/**
 * Records academic evaluations for a student's enrolled courses.
 * Submits evaluation transactions to the blockchain.
 * @author Diego Da Giau
 * @param {string} studentWallet - The student's academic wallet address
 * @param {eduwallet.Evaluation[]} evaluations - Array of academic evaluations to record
 * @returns {Promise<void>} Promise that resolves when the student is successfully evaluated for all submitted courses
 * @throws {Error} If no university wallet is available for evaluation, if any evaluations fail, or if the evaluation process encounters an error, with the error message from the underlying error
 */
export async function evaluateStudent(studentWallet: string, evaluations: eduwallet.Evaluation[]): Promise<void> {
    if (!uni) {
        throw new Error("University not present - subscribe a university first");
    }

    try {
        if (VERBOSE) {
            console.log("\nEvaluating student...");
        }

        // Use the SDK to record evaluations for the student
        await eduwallet.evaluateStudent(uni, studentWallet, evaluations);
    } catch (error) {
        throw new Error(`${error}`);
    }
}

/**
 * Requests permission to access a student's academic wallet.
 * Universities must request access before they can read or modify student records.
 * @author Diego Da Giau
 * @param {string} studentWallet - The student's academic wallet address
 * @param {eduwallet.PermissionType} permission - Type of permission requested (Read or Write)
 * @returns {Promise<void>} Promise that resolves when the permission request is submitted and confirmed
 * @throws {Error} If no university wallet is available for requesting permission or if the permission request process fails, with the error message from the underlying error
 */
export async function requestPermission(studentWallet: string, permission: eduwallet.PermissionType): Promise<void> {
    if (!uni) {
        throw new Error("University not present - subscribe a university first");
    }

    try {
        if (VERBOSE) {
            console.log(`\nAsking for ${permission === eduwallet.PermissionType.Read ? 'read' : 'write'} permission...`)
        }

        // Use the SDK to request permission for the student's wallet
        await eduwallet.askForPermission(uni, studentWallet, permission);
    } catch (error) {
        throw new Error(`${error}`);
    }
}

/**
 * Verifies a university's permission level for a student's academic wallet.
 * Checks the current permission level available to the active university wallet.
 * @author Diego Da Giau
 * @param {string} studentWallet - The student's academic wallet address
 * @returns {Promise<void>} Promise that resolves when the permission verification is complete
 * @throws {Error} If no university wallet is available for verification or if the verification process fails, with the error message from the underlying error
 */
export async function verifyPermission(studentWallet: string): Promise<void> {
    if (!uni) {
        throw new Error("University not present - subscribe a university first");
    }

    try {
        if (VERBOSE) {
            console.log(`\nVerifying permission...`)
        }

        // Use the SDK to check the current permission level
        const permission = await eduwallet.verifyPermission(uni, studentWallet);

        // Display the permission level
        console.log(`\nPERMISSION:`);
        console.log(`Type: ${permission === null ? 'None' : permission === eduwallet.PermissionType.Read ? 'Read' : 'Write'}\n`);
    } catch (error) {
        throw new Error(`${error}`);

    }
}

/**
 * Changes the active university wallet used for all operations.
 * Allows switching between different university credentials.
 * @author Diego Da Giau
 * @param {Wallet} newUniversity - The new university wallet to use
 * @returns {void}
 * @throws {Error} If connecting the new university wallet fails, with the error message from the underlying error
 */
export function changeUniversity(newUniversity: Wallet): void {
    try {
        // Connect the new university wallet to the provider
        uni = newUniversity.connect(PROVIDER);
    } catch (error) {
        throw new Error(`${error}`);
    }
}
