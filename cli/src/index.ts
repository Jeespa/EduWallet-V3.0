import figlet from 'figlet';
import inquirer from 'inquirer';
import { changeUniversity, deployStudentsRegister, enrollStudent, evaluateStudent, getStudentInfo, getStudentInfoResults, registerStudent, requestPermission, subscribeUniversity, uni, verifyPermission } from './interact';
import ora from 'ora';
import eduwallet, { PermissionType } from 'eduwallet-sdk';
import { Wallet } from 'ethers';

/**
 * Validates an Ethereum private key format.
 * Ensures the input string is a properly formatted hexadecimal private key.
 * @author Diego Da Giau
 * @param {string} input - The private key string to validate
 * @returns {string|boolean} Error message if validation fails, true if validation succeeds
 */
const validatePrivateKey = (input: string): string | boolean => {
    // Check that input matches the expected format for Ethereum private keys
    const keyRegex = /^0x[0-9a-fA-F]{64}$/;
    if (!keyRegex.test(input)) {
        return 'Please enter a valid Ethereum private key (0x followed by 64 hex characters)';
    }

    // Input is valid
    return true;
};

/**
 * Validates date format and ensures it represents a valid past date.
 * Performs multiple validation checks on date strings for user input.
 * @author Diego Da Giau
 * @param {string} input - The date string to validate in YYYY-MM-DD format
 * @returns {string|boolean} Error message if validation fails, true if validation succeeds
 */
const validateDate = (input: string): string | boolean => {
    // Check if input matches the YYYY-MM-DD format
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(input)) {
        return 'Please enter a valid date in YYYY-MM-DD format';
    }

    // Check if the date is valid (not an invalid date like February 31)
    const date = new Date(input);
    if (isNaN(date.getTime())) {
        return 'Please enter a valid date';
    }

    // Check if the date is after Unix epoch (1970-01-01)
    const unixEpoch = new Date('1970-01-01');
    if (date <= unixEpoch) {
        return 'The date must be after January 1, 1970';
    }

    // Check if the date is in the past
    if (date > new Date()) {
        return 'The date cannot be in the future';
    }

    // Input is valid
    return true;
};

/**
 * Validates string input for appropriate length constraints.
 * Ensures strings meet minimum and maximum length requirements.
 * @author Diego Da Giau
 * @param {string} input - The string to validate
 * @returns {string|boolean} Error message if validation fails, true if validation succeeds
 */
const validateString = (input: string): string | boolean => {
    // Enforce minimum string length
    if (input.length < 3) {
        return 'Please enter a string of at least 3 characters';
    }

    // Enforce maximum string length
    else if (input.length > 30) {
        return 'Please enter a string of maximum 30 characters';
    }

    // Input is valid
    return true;
};

/**
 * Validates a university name for appropriate length constraints.
 * Ensures university names meet minimum and maximum length requirements.
 * @author Diego Da Giau
 * @param {string} input - The university name string to validate
 * @returns {string|boolean} Error message if validation fails, true if validation succeeds
 */
const validateLongString = (input: string): string | boolean => {
    // Enforce minimum string length
    if (input.length < 3) {
        return 'Please enter a string of at least 3 characters';
    }

    // Enforce maximum string length
    else if (input.length > 60) {
        return 'Please enter a string of maximum 30 characters';
    }

    // Input is valid
    return true;
};

/**
 * Validates a university short name for appropriate length constraints.
 * Ensures short names meet minimum and maximum length requirements.
 * @author Diego Da Giau
 * @param {string} input - The short name string to validate
 * @returns {string|boolean} Error message if validation fails, true if validation succeeds
 */
const validateShortName = (input: string): string | boolean => {
    // Enforce minimum short name length
    if (input.length < 3) {
        return 'Please enter a short name of at least 3 characters';
    }
    // Enforce maximum short name length
    else if (input.length > 8) {
        return 'Please enter a short name of maximum 8 characters';
    }

    // Input is valid
    return true;
};

/**
 * Validates an Ethereum wallet address format.
 * Ensures the input string is a properly formatted hexadecimal address.
 * @author Diego Da Giau
 * @param {string} input - The Ethereum address to validate
 * @returns {string|boolean} Error message if validation fails, true if validation succeeds
 */
const validateAddress = (input: string): string | boolean => {
    // Check that input matches the expected format for Ethereum addresses
    const addressRegex = /^0x[a-fA-F0-9]{40}$/;
    if (!addressRegex.test(input)) {
        return 'Please enter a valid Ethereum address (0x followed by 40 hex characters)';
    }

    // Input is valid
    return true;
};

/**
 * Validates an ECTS credit value format.
 * Ensures the input string is a properly formatted decimal number.
 * @author Diego Da Giau
 * @param {string} input - The ECTS credit value to validate
 * @returns {string|boolean} Error message if validation fails, true if validation succeeds
 */
const validateEcts = (input: string): string | boolean => {
    // Check that input matches the expected format for ECTS values
    const ectsRegex = /^[1-9][0-9]*(.[0-9]+)?$/;
    if (!ectsRegex.test(input)) {
        return 'Please enter a valid ECTS value (positive number)';
    }

    // Enforce maximum ECTS value constraint
    const ects = parseFloat(input);
    if (ects > 100) {
        return 'Please enter a valid ECTS value (maximum 100 credits allowed)';
    }

    // Input is valid
    return true;
};

/**
 * Validates a course evaluation result for appropriate length constraints.
 * Ensures grades meet minimum and maximum length requirements.
 * @author Diego Da Giau
 * @param {string} input - The result string to validate
 * @returns {string|boolean} Error message if validation fails, true if validation succeeds
 */
const validateGrade = (input: string): string | boolean => {
    // Enforce minimum short name length
    if (input.length === 0) {
        return 'Please enter a value';
    }
    // Enforce maximum short name length
    else if (input.length > 15) {
        return 'Please enter a result of maximum 15 characters';
    }

    // Input is valid
    return true;
};

async function getStudentAddress(): Promise<string> {
    const answers = await inquirer.prompt([
        {
            type: 'input',
            name: 'address',
            message: "Enter the student's academic wallet address (0x...):",
            validate: validateAddress,
        },
    ]);
    return answers.address as string;
}

/**
 * Deploys the core Students Register contract to the blockchain.
 * This contract serves as the entry point for the academic credential system.
 * Manages the deployment process with visual feedback using a spinner.
 * @author Diego Da Giau
 * @returns {Promise<void>} Promise that resolves when the contract is successfully deployed
 * @throws {Error} If deployment fails for any reason, exits the process with code 1
 */
async function deployRegisterContract(): Promise<void> {
    try {
        const spinner = ora('Deploying register contract...').start();

        await deployStudentsRegister();

        spinner.succeed('Register contract deployed successfully!');
    } catch (error) {
        console.error("Failed to deploy register contract:", error);
        process.exit(1);
    }
}

/**
 * Prompts for university details and registers a new university in the system.
 * Collects and validates university name, country, and short name.
 * @author Diego Da Giau
 * @returns {Promise<void>} Promise that resolves when the university is successfully subscribed or fails
 */
async function registerUniversityCommand(): Promise<void> {
    try {
        const answers = await inquirer.prompt([
            {
                type: 'input',
                name: 'name',
                message: 'Enter the university name:',
                validate: validateLongString,
            },
            {
                type: 'input',
                name: 'country',
                message: 'Enter the university country:',
                validate: validateString,
            },
            {
                type: 'input',
                name: 'shortName',
                message: 'Enter the university short name:',
                validate: validateShortName,
            },
        ]);
        const spinner = ora('Subscribing the university...').start();
        try {
            await subscribeUniversity(answers.name, answers.country, answers.shortName);
            spinner.succeed('University subscribed successfully!');
        } catch (error) {
            spinner.fail(`Failed to subscribe the university. Try again.`);
            //console.error('University subscription error details:', error);
        }
    } catch (error) {
        console.error('Failed to collect university information:', error);
    }
}

/**
 * Registers a new student in the system (EduWallet V3.0).
 *
 * No personal data is collected — the SDK creates a wallet and derives the
 * student's did:key hash automatically. Personal data is captured later via
 * the BankID KYC flow on the student's mobile device.
 */
async function registerStudentCommand(): Promise<void> {
    try {
        const spinner = ora('Registering the student...').start();
        try {
            await registerStudent();
            spinner.succeed('Student registered successfully! (Personal data will be captured via KYC on the mobile app)');
        } catch (error) {
            spinner.fail(`Failed to register the student. Try again.`);
        }
    } catch (error) {
        console.error('Failed to register student:', error);
    }
}

/**
 * Retrieves basic student information from the blockchain.
 * Prompts for a student wallet address and fetches their basic profile.
 * @author Diego Da Giau
 * @returns {Promise<void>} Promise that resolves when student information is successfully retrieved
 */
async function getStudentInfoCommand(): Promise<void> {
    try {
        const address = await getStudentAddress();

        const spinner = ora("Retrieving the student's on-chain identity data...").start();
        try {
            await getStudentInfo(address);
            spinner.succeed("Student's on-chain identity data retrieved successfully");
        } catch (error) {
            spinner.fail(`Failed to retrieve the student's on-chain identity data. Check the address.`);
            //console.error('Student info retrieval error details:', error);
        }
    } catch (error) {
        console.error('Failed to collect wallet address:', error);
    }
}

/**
 * Retrieves comprehensive student information including academic results.
 * Prompts for a student wallet address and fetches complete academic profile.
 * @author Diego Da Giau
 * @returns {Promise<void>} Promise that resolves when student information and results are successfully retrieved
 */
async function getStudentResultsCommand(): Promise<void> {
    try {
        const address = await getStudentAddress();

        const spinner = ora("Retrieving the student's personal details and the academic results...").start();
        try {
            await getStudentInfoResults(address);
            spinner.succeed("Student's personal details and academic results retrieved successfully");
        } catch (error) {
            spinner.fail("Failed to retrieve student's personal details and the academic results. Check the address or your permission.");
            //console.error('Student info and results retrieval error details:', error);
        }
    } catch (error) {
        console.error('Failed to collect wallet address:', error);
    }
}

/**
 * Enrolls a student in one or more academic courses.
 * Prompts for student wallet address and course details, then submits enrollment transactions.
 * Supports adding multiple courses in a single enrollment session.
 * @author Diego Da Giau
 * @returns {Promise<void>} Promise that resolves when the student is successfully enrolled in all courses
 */
async function enrollStudentCommand(): Promise<void> {
    try {
        // Get student wallet address
        const address = await getStudentAddress();

        // Collection of courses to enroll the student in
        const courses: eduwallet.CourseInfo[] = [];

        // Continue collecting course information until user chooses to enroll
        while (true) {
            try {
                const answers = await inquirer.prompt([
                    {
                        type: 'input',
                        name: 'code',
                        message: 'Enter course code:',
                        validate: validateString,
                    },
                    {
                        type: 'input',
                        name: 'name',
                        message: 'Enter course name:',
                        validate: validateLongString,
                    },
                    {
                        type: 'input',
                        name: 'degreeCourse',
                        message: 'Enter degree course name:',
                        validate: validateLongString,
                    },
                    {
                        type: 'input',
                        name: 'ects',
                        message: 'Enter ECTS number:',
                        validate: validateEcts,
                    },
                ]);

                // Add the course to the collection
                courses.push({
                    code: answers.code,
                    name: answers.name,
                    degreeCourse: answers.degreeCourse,
                    ects: parseFloat(answers.ects),
                });

                // Check if user wants to add more courses or proceed with enrollment
                const action = await inquirer.prompt([
                    {
                        type: 'list',
                        name: 'action',
                        message: 'What would you like to do?',
                        choices: [
                            'Add another course',
                            'Enroll',
                        ]
                    }
                ]);

                // Break the loop if user chooses to enroll
                if (action.action === 'Enroll') {
                    break;
                }
            } catch (error) {
                console.error('Error while collecting course information:', error);
            }
        }

        // Process enrollment with visual feedback
        if (courses.length === 0) {
            console.error('No courses added. Enrollment cancelled.');
            return;
        }

        const spinner = ora('Enrolling the student...').start();
        try {
            await enrollStudent(address, courses);
            spinner.succeed('Student enrolled successfully');
        } catch (error) {
            spinner.fail(`Failed to enroll the student`);
            //console.error('Student enrollment error details:', error);
        }
    } catch (error) {
        console.error('Failed to complete enrollment process:', error);
    }
}

/**
 * Records academic evaluations for enrolled students.
 * Prompts for student wallet address and evaluation details, then submits evaluation transactions.
 * Supports adding multiple evaluations in a single session.
 * @author Diego Da Giau
 * @returns {Promise<void>} Promise that resolves when the student is successfully evaluated for all submitted courses
 */
async function evaluateStudentCommand(): Promise<void> {
    try {
        // Get student wallet address
        const address = await getStudentAddress();

        const evaluations: eduwallet.Evaluation[] = [];

        // Continue collecting evaluation information until user chooses to submit
        while (true) {
            try {
                const answers = await inquirer.prompt([
                    {
                        type: 'input',
                        name: 'code',
                        message: 'Enter course code:',
                        validate: validateString,
                    },
                    {
                        type: 'input',
                        name: 'evaluationDate',
                        message: 'Enter evaluation date (YYYY-MM-DD):',
                        validate: validateDate,
                    },
                    {
                        type: 'input',
                        name: 'grade',
                        message: 'Enter evaluation result:',
                        validate: validateGrade,
                    },
                    {
                        type: 'input',
                        name: 'certificate',
                        message: 'Enter certificate path (optional):',
                    },
                ]);

                // Add the evaluation to the collection
                evaluations.push({
                    code: answers.code,
                    evaluationDate: answers.evaluationDate,
                    grade: answers.grade,
                    certificate: answers.certificate === '' ? null : answers.certificate,
                });

                // Check if user wants to add more evaluations or proceed with submission
                const action = await inquirer.prompt([
                    {
                        type: 'list',
                        name: 'action',
                        message: 'What would you like to do?',
                        choices: [
                            'Add another record',
                            'Evaluate',
                        ]
                    }
                ]);

                // Break the loop if user chooses to evaluate
                if (action.action === 'Evaluate') {
                    break;
                }
            } catch (error) {
                console.error('Error while collecting evaluation information:', error);
            }
        }

        // Process evaluations with visual feedback
        if (evaluations.length === 0) {
            console.log('No evaluations added. Evaluation cancelled.');
            return;
        }

        const spinner = ora('Evaluating the student...').start();
        try {
            await evaluateStudent(address, evaluations);
            spinner.succeed('Student evaluated successfully');
        } catch (error) {
            spinner.fail(`Failed to evaluate student`);
            //console.error('Student evaluation error details:', error);
        }
    } catch (error) {
        console.error('Failed to complete evaluation process:', error);
    }
}

/**
 * Requests permission to access a student's academic wallet.
 * Universities must request access before they can read or modify student records.
 * Prompts for student wallet address and desired permission type.
 * @author Diego Da Giau
 * @returns {Promise<void>} Promise that resolves when the permission request is submitted and confirmed
 */
async function requestPermissionCommand(): Promise<void> {
    try {
        // Get student wallet address
        const address = await getStudentAddress();

        // Get permission type
        const answers = await inquirer.prompt([
            {
                type: 'list',
                name: 'action',
                message: 'What type of permission do you want to ask?',
                choices: [
                    'Read',
                    'Write'
                ]
            }
        ]);

        // Determine permission type based on user selection
        let permission: PermissionType;
        switch (answers.action) {
            case 'Read':
                permission = PermissionType.Read;
                break;
            case 'Write':
                permission = PermissionType.Write;
                break;
            default:
                permission = PermissionType.Read;
        }

        // Process permission request with visual feedback
        const spinner = ora(`Requesting the ${answers.action} permission...`).start();
        try {
            await requestPermission(address, permission);
            spinner.succeed('Permission requested successfully');
        } catch (error) {
            spinner.fail(`Failed to request permission. Maybe you already have the requested permission or a higher one...`);
            //console.error('Permission request error details:', error);
        }
    } catch (error) {
        console.error('Failed to collect permission request information:', error);
    }
}

/**
 * Verifies a university's permission level for a student's academic wallet.
 * Checks the current permission level available to the active university wallet.
 * @author Diego Da Giau
 * @returns {Promise<void>} Promise that resolves when the permission verification is complete
 */
async function verifyPermissionCommand(): Promise<void> {
    try {
        // Get student wallet address
        const address = await getStudentAddress();

        // Process verification with visual feedback
        const spinner = ora(`Verifying the available permission...`).start();
        try {
            await verifyPermission(address);
            spinner.succeed('Permission verified successfully');
        } catch (error) {
            spinner.fail('Failed to verify the permission');
            //console.error('Permission verification error details:', error);
        }
    } catch (error) {
        console.error('Failed to collect wallet address:', error);
    }
}

/**
 * Changes the active university wallet used for all operations.
 * Allows switching between different university credentials.
 * @author Diego Da Giau
 * @returns {Promise<void>} Promise that resolves when the university wallet is successfully changed
 */
/**
 * Issues an AcademicResult SD-JWT VC via the gateway.
 *
 * Calls POST /vc/academic-result on the gateway, authenticated as the active
 * university EOA. The gateway issues the VC and stores it for the student to
 * retrieve via GET /vc/academic-results/:studentDid (the mobile app "Refresh"
 * button). The on-chain enroll + evaluate are handled server-side.
 */
async function issueAcademicResultVcCommand(): Promise<void> {
    if (!uni) {
        console.log('No university wallet loaded. Subscribe a university first.');
        return;
    }

    let studentDid: string;
    let studentSca: string;
    let courseCode: string;
    let courseName: string;
    let grade: string;
    let ects: string;
    let date: string;
    let degreeProgramme: string;

    try {
        const answers = await inquirer.prompt([
            {
                type: 'input',
                name: 'studentDid',
                message: "Enter student's did:key (did:key:z...):",
                validate: (v: string) => v.startsWith('did:key:z') || 'Must start with did:key:z',
            },
            {
                type: 'input',
                name: 'studentSca',
                message: "Enter student's SCA address (0x...):",
                validate: validateAddress,
            },
            {
                type: 'input',
                name: 'courseCode',
                message: 'Enter course code (e.g. TMA4100):',
                validate: validateString,
            },
            {
                type: 'input',
                name: 'courseName',
                message: 'Enter course name:',
                validate: validateLongString,
            },
            {
                type: 'input',
                name: 'grade',
                message: 'Enter grade (e.g. B):',
                validate: validateGrade,
            },
            {
                type: 'input',
                name: 'ects',
                message: 'Enter ECTS credits:',
                validate: validateEcts,
            },
            {
                type: 'input',
                name: 'date',
                message: 'Enter evaluation date (YYYY-MM-DD):',
                validate: validateDate,
            },
            {
                type: 'input',
                name: 'degreeProgramme',
                message: 'Enter degree programme (e.g. Master in Computer Engineering):',
                validate: validateLongString,
            },
        ]);

        studentDid = answers.studentDid as string;
        studentSca = answers.studentSca as string;
        courseCode = answers.courseCode as string;
        courseName = answers.courseName as string;
        grade = answers.grade as string;
        ects = answers.ects as string;
        date = answers.date as string;
        degreeProgramme = answers.degreeProgramme as string;
    } catch (error) {
        console.error('Failed to collect academic result information:', error);
        return;
    }

    const spinner = ora('Issuing Academic Result VC via gateway...').start();
    try {
        const gatewayUrl = process.env.GATEWAY_URL || 'http://localhost:3000';
        const bearerToken = uni.address;

        const response = await fetch(`${gatewayUrl}/vc/academic-result`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${bearerToken}`,
            },
            body: JSON.stringify({
                studentDid,
                studentSca,
                courseCode,
                courseName,
                grade,
                ects,
                date,
                degreeProgramme,
            }),
        });

        if (!response.ok) {
            const body = await response.json().catch(() => ({})) as { error?: string };
            throw new Error(body.error ?? `Gateway returned ${response.status}`);
        }

        const result = await response.json() as { academicResultVc: string; credentialId: string };
        spinner.succeed('Academic Result VC issued successfully!');
        console.log(`\nCredential ID: ${result.credentialId}`);
        console.log(`\nThe student can fetch this VC in the mobile app via the "Refresh" button on the Credentials tab.`);
        console.log(`\nSD-JWT (first 80 chars): ${result.academicResultVc.slice(0, 80)}...`);
    } catch (error) {
        spinner.fail(`Failed to issue Academic Result VC: ${error instanceof Error ? error.message : error}`);
    }
}

/**
 * Prompts for an SD-JWT string and calls POST /vc/verify on the gateway.
 * Displays the verification result including issuer, claims, and revocation status.
 */
async function verifyVcCommand(): Promise<void> {
    let sdJwt: string;
    try {
        const answers = await inquirer.prompt([
            {
                type: 'input',
                name: 'sdJwt',
                message: 'Paste the SD-JWT credential to verify:',
                validate: (v: string) => v.trim().length > 0 || 'SD-JWT cannot be empty',
            },
        ]);
        sdJwt = (answers.sdJwt as string).trim();
    } catch {
        console.error('Prompt cancelled');
        return;
    }

    const spinner = ora('Verifying credential...').start();
    try {
        const gatewayUrl = process.env.GATEWAY_URL || 'http://localhost:3000';
        const response = await fetch(`${gatewayUrl}/vc/verify`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sdJwtPresentation: sdJwt }),
        });

        const result = await response.json() as {
            valid: boolean;
            issuer?: string;
            subject?: string;
            credentialType?: string;
            claims?: Record<string, string>;
            credentialId?: string;
            revoked?: boolean;
            error?: string;
        };

        if (!result.valid) {
            spinner.fail(`Invalid credential: ${result.error ?? 'Unknown reason'}`);
            return;
        }

        if (result.revoked) {
            spinner.warn('Credential signature is valid but it has been REVOKED');
        } else {
            spinner.succeed('Credential verified successfully');
        }

        console.log(`\n  Type:     ${result.credentialType}`);
        console.log(`  Issuer:   ${result.issuer}`);
        console.log(`  Subject:  ${result.subject}`);
        console.log(`  Revoked:  ${result.revoked ? 'YES' : 'No'}`);
        console.log(`  ID:       ${result.credentialId}`);

        if (result.claims && Object.keys(result.claims).length > 0) {
            console.log('\n  Disclosed claims:');
            for (const [key, value] of Object.entries(result.claims)) {
                console.log(`    ${key}: ${value}`);
            }
        } else {
            console.log('\n  No claims disclosed (minimal presentation)');
        }
    } catch (error) {
        spinner.fail(`Failed to verify credential: ${error instanceof Error ? error.message : String(error)}`);
    }
}

async function changeUniversityCommand(): Promise<void> {
    try {
        // Get university private key
        const answers = await inquirer.prompt([
            {
                type: 'input',
                name: 'privateKey',
                message: 'Enter university private key (0x...):',
                validate: validatePrivateKey,
            },
        ]);

        // Process university change with visual feedback
        const spinner = ora('Changing the current university...').start();
        try {
            changeUniversity(new Wallet(answers.privateKey));
            spinner.succeed('Current university changed successfully');
        } catch (error) {
            spinner.fail('Failed to change the current university');
            //console.error('University change error details:', error);
        }
    } catch (error) {
        console.error('Failed to collect university private key:', error);
    }
}

/**
 * Displays and manages the main interactive menu of the EduWallet CLI.
 * Provides different options based on whether a university wallet is configured.
 * Handles user selection and routes to appropriate command handlers.
 * @author Diego Da Giau
 * @returns {Promise<void>} Promise that resolves when the user exits the CLI
 */
async function mainMenu(): Promise<void> {
    // Continue displaying menu until user explicitly exits
    while (true) {
        try {
            let choices: string[] = [];
            // Show different menu options based on university wallet availability
            if (uni) {
                // Full menu when university wallet is configured
                choices = [
                    'Register a university',
                    'Register a student',
                    "Get student's on-chain identity (DID hash)",
                    "Get student's academic results",
                    'Enroll a student',
                    'Record student evaluation',
                    'Issue Academic Result VC',
                    'Verify Credential (SD-JWT)',
                    'Request permission from a student',
                    'Verify permission for a student',
                    'Change current university',
                    'Exit'
                ];
            } else {
                // Limited menu when no university wallet is configured
                choices = [
                    'Register a university',
                    'Verify Credential (SD-JWT)',
                    'Exit'
                ];
            }

            const action = await inquirer.prompt([
                {
                    type: 'list',
                    name: 'action',
                    message: 'What would you like to do?',
                    choices,
                }
            ]);

            // Process user selection and execute corresponding command
            switch (action.action) {
                case 'Register a university':
                    await registerUniversityCommand();
                    break;
                case 'Register a student':
                    await registerStudentCommand();
                    break;
                case "Get student's on-chain identity (DID hash)":
                    await getStudentInfoCommand();
                    break;
                case "Get student's academic results":
                    await getStudentResultsCommand();
                    break;
                case 'Enroll a student':
                    await enrollStudentCommand();
                    break;
                case 'Record student evaluation':
                    await evaluateStudentCommand();
                    break;
                case 'Issue Academic Result VC':
                    await issueAcademicResultVcCommand();
                    break;
                case 'Verify Credential (SD-JWT)':
                    await verifyVcCommand();
                    break;
                case 'Request permission from a student':
                    await requestPermissionCommand();
                    break;
                case 'Verify permission for a student':
                    await verifyPermissionCommand();
                    break;
                case 'Change current university':
                    await changeUniversityCommand();
                    break;
                case 'Exit':
                    console.log('Goodbye!');
                    process.exit(0);
                default:
                    // Handle any unexpected selections
                    console.log('Invalid option selected');
                    break;
            }
        } catch (error) {
            //console.error('An unexpected error occurred in the main menu:', error);
            console.log('Restarting menu...');
        }
    }
}

// Main execution starts here
async function main() {
    try {
        console.log(figlet.textSync('EduWallet'));
        await deployRegisterContract();
        await mainMenu();
    } catch (error) {
        //console.error('A critical error occurred:', error);
        process.exit(1);
    }
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});
