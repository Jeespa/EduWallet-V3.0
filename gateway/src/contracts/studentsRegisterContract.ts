// gateway/src/contracts/studentsRegisterContract.ts

/**
 * Minimal ABI for the StudentsRegister contract,
 * only with the functions the gateway actually needs.
 */
export const STUDENTS_REGISTER_ABI = [
  {
    inputs: [],
    name: "getStudentAccount",
    outputs: [
      {
        internalType: "address",
        name: "",
        type: "address",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "getUniversityAccount",
    outputs: [
      {
        internalType: "address",
        name: "",
        type: "address",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  // called by the university SCA to register a new student
  {
    inputs: [
      { internalType: "address", name: "_student", type: "address" },
      { internalType: "bytes32", name: "_didKeyHash", type: "bytes32" },
    ],
    name: "registerStudent",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;
