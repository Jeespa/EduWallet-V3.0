import { ethers } from "ethers";
import { ENTRY_POINT_ADDRESS, PAYMASTER_ADDRESS, CHAIN_ID } from "./config";

/**
 * Light-weight error logger used inside this module.
 * Keeps a single place to change logging behaviour if needed later.
 *
 * @param msg - Human readable message describing the context
 * @param err - Original error object
 */
function logError(msg: string, err: unknown) {
  console.error(msg, err);
}

/** Minimal ABI for the EntryPoint contract (only the pieces we use). */
const ENTRY_POINT_ABI = [
  "function getNonce(address sender, uint192 key) view returns (uint256)",
  "function handleOps((address sender,uint256 nonce,bytes initCode,bytes callData,bytes32 accountGasLimits,uint256 preVerificationGas,bytes32 gasFees,bytes paymasterAndData,bytes signature)[] ops, address payable beneficiary)",
  // For verifyTransaction:
  "event UserOperationEvent(bytes32 indexed userOpHash, address indexed sender, address indexed paymaster, uint256 nonce, bool success, uint256 actualGasCost, uint256 actualGasUsed)",
  "event UserOperationRevertReason(bytes32 indexed userOpHash, address sender, uint256 nonce, bytes revertReason)",
];

/** Minimal ABI for the SmartAccount contract (only the execute function). */
const SMART_ACCOUNT_ABI = [
  "function execute(address target, uint256 value, bytes data)",
];

/**
 * EIP-712 domain parameters for ERC-4337 user operations.
 * These values must match the EntryPoint implementation.
 */
const DOMAIN_NAME = "ERC4337";
const DOMAIN_VERSION = "1";

/**
 * Builds the EIP-712 domain for signing packed user operations.
 *
 * @param entryPoint - Address of the EntryPoint contract
 * @param chainId - Current chain identifier
 * @returns Typed data domain structure for ethers.js
 */
export function getErc4337TypedDataDomain(
  entryPoint: string,
  chainId: number
): ethers.TypedDataDomain {
  return {
    name: DOMAIN_NAME,
    version: DOMAIN_VERSION,
    chainId,
    verifyingContract: entryPoint,
  };
}

/**
 * Returns the EIP-712 type definition for packed user operations.
 *
 * @returns Mapping from type name to list of typed fields
 */
export function getErc4337TypedDataTypes(): {
  [type: string]: ethers.TypedDataField[];
} {
  return {
    PackedUserOperation: [
      { name: "sender", type: "address" },
      { name: "nonce", type: "uint256" },
      { name: "initCode", type: "bytes" },
      { name: "callData", type: "bytes" },
      { name: "accountGasLimits", type: "bytes32" },
      { name: "preVerificationGas", type: "uint256" },
      { name: "gasFees", type: "bytes32" },
      { name: "paymasterAndData", type: "bytes" },
    ],
  };
}

/**
 * JSON-serializable form of a packed UserOperation.
 * bigint fields (nonce, preVerificationGas) are expressed as 0x-prefixed hex strings
 * so they survive JSON.stringify/parse on any platform including mobile.
 */
export interface PackedUserOpJson {
  sender: string;
  nonce: string;
  initCode: string;
  callData: string;
  accountGasLimits: string;
  preVerificationGas: string;
  gasFees: string;
  paymasterAndData: string;
  signature?: string;
}

/**
 * Packs paymaster details into the `paymasterAndData` field
 * expected by the EntryPoint contract.
 *
 * @param paymaster - Address of the paymaster contract
 * @param paymasterVerificationGasLimit - Gas limit for the validation phase
 * @param postOpGasLimit - Gas limit for the post-operation phase
 * @param paymasterData - Optional opaque payload interpreted by the paymaster
 * @returns Encoded `paymasterAndData` byte string
 */
function packPaymasterData(
  paymaster: string,
  paymasterVerificationGasLimit: number | bigint,
  postOpGasLimit: number | bigint,
  paymasterData: string
): string {
  return ethers.concat([
    paymaster,
    ethers.zeroPadValue(ethers.toBeHex(paymasterVerificationGasLimit), 16),
    ethers.zeroPadValue(ethers.toBeHex(postOpGasLimit), 16),
    paymasterData,
  ]);
}

/**
 * Internal representation of a full user operation as used by this helper.
 * Closely mirrors the ERC-4337 structure but keeps separate fields
 * for easier manipulation before packing.
 */
interface UserOperation {
  sender: string;
  nonce: bigint;
  initCode: string;
  callData: string;
  callGasLimit: bigint;
  verificationGasLimit: bigint;
  preVerificationGas: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
  paymaster: string;
  paymasterVerificationGasLimit: bigint;
  paymasterPostOpGasLimit: bigint;
  paymasterData: string;
  signature: string;
}

/**
 * Packed representation of a user operation as expected by
 * EntryPoint.handleOps. Several gas related fields are compressed
 * into two 32-byte values.
 */
interface PackedUserOperation {
  sender: string;
  nonce: bigint;
  initCode: string;
  callData: string;
  accountGasLimits: string;
  preVerificationGas: bigint;
  gasFees: string;
  paymasterAndData: string;
  signature: string;
}

/**
 * Helper for constructing and sending ERC-4337 user operations.
 *
 * This class intentionally uses minimal ABIs and plain ethers.js
 * contracts so it stays independent from the original SDK and can be
 * used directly by the HTTP gateway.
 */
export class AccountAbstraction {
  private provider: ethers.Provider;
  private entryPoint: ethers.Contract;
  private signer: ethers.Signer;

  /**
   * Creates a new account abstraction helper.
   *
   * @param provider - JSON-RPC provider used to query fees and send transactions
   * @param signer - Wallet that signs user operations and pays for handleOps
   */
  constructor(provider: ethers.Provider, signer: ethers.Signer) {
    this.provider = provider;
    this.signer = signer;
    this.entryPoint = new ethers.Contract(
      ENTRY_POINT_ADDRESS,
      ENTRY_POINT_ABI,
      provider
    );
  }

  /**
   * Builds an unsigned user operation that calls `execute` on a student smart account.
   *
   * @param params.sender - Address of the smart account (student SCA)
   * @param params.target - Contract that should be called via `execute`
   * @param params.value - Ether value forwarded to the target
   * @param params.data - ABI encoded function data for the target call
   * @param params.initCode - Optional deployment code for the account (unused here)
   * @returns Fully populated user operation with a dummy signature
   */
  async createUserOp({
    sender,
    target,
    value,
    data,
    initCode = "0x",
  }: {
    sender: string;
    target: string;
    value: bigint;
    data: string;
    initCode?: string;
  }): Promise<UserOperation> {
    const accountContract = new ethers.Contract(
      sender,
      SMART_ACCOUNT_ABI,
      this.provider
    );
    const callData = accountContract.interface.encodeFunctionData("execute", [
      target,
      value,
      data,
    ]);

    // Cast to any to avoid strict typing issues on ABI-dynamic function
    const nonce: bigint = await (this.entryPoint as any).getNonce(sender, 0);

    const feeData = await this.provider.getFeeData();

    const userOp: UserOperation = {
      sender,
      nonce,
      initCode,
      callData,
      // Static gas limits tuned for local development; can be adjusted later.
      callGasLimit: BigInt(1_000_000),
      verificationGasLimit: BigInt(5_000_000),
      preVerificationGas: BigInt(500_000),
      maxFeePerGas: feeData.maxFeePerGas || BigInt(2_000_000_000),
      maxPriorityFeePerGas:
        feeData.maxPriorityFeePerGas || BigInt(1_000_000_000),
      paymaster: PAYMASTER_ADDRESS,
      paymasterVerificationGasLimit: BigInt(2_000_000),
      paymasterPostOpGasLimit: BigInt(2_000_000),
      paymasterData: "0x",
      signature: "0x",
    };

    return userOp;
  }

  /**
   * Signs a user operation using EIP-712 typed data.
   *
   * @param userOp - Unsigned user operation
   * @returns Copy of the operation with the `signature` field filled in
   */
  async signUserOp(userOp: UserOperation): Promise<UserOperation> {
    const packedUserOp = this.packUserOp(userOp);

    const signature = await this.signer.signTypedData(
      getErc4337TypedDataDomain(ENTRY_POINT_ADDRESS, CHAIN_ID),
      getErc4337TypedDataTypes(),
      packedUserOp
    );

    return { ...userOp, signature };
  }

  /**
   * Packs a full user operation into the compact structure expected
   * by the EntryPoint contract.
   *
   * @param userOp - Full user operation
   * @returns Packed representation ready for `handleOps`
   */
  packUserOp(userOp: UserOperation): PackedUserOperation {
    const accountGasLimits = ethers.solidityPacked(
      ["uint128", "uint128"],
      [userOp.callGasLimit, userOp.verificationGasLimit]
    );

    const gasFees = ethers.solidityPacked(
      ["uint128", "uint128"],
      [userOp.maxPriorityFeePerGas, userOp.maxFeePerGas]
    );

    const paymasterAndData = packPaymasterData(
      userOp.paymaster,
      userOp.paymasterVerificationGasLimit,
      userOp.paymasterPostOpGasLimit,
      userOp.paymasterData
    );

    return {
      sender: userOp.sender,
      nonce: userOp.nonce,
      initCode: userOp.initCode,
      callData: userOp.callData,
      accountGasLimits,
      preVerificationGas: userOp.preVerificationGas,
      gasFees,
      paymasterAndData,
      signature: userOp.signature,
    };
  }

  /**
   * Signs and submits one or more user operations via EntryPoint.handleOps.
   *
   * @param userOps - Array of user operations to include in the batch
   * @param beneficiary - Address that will receive the collected gas fees
   * @returns Transaction response for the handleOps call
   * @throws Propagates any error returned by ethers.js or the EntryPoint
   */
  async executeUserOps(
    userOps: UserOperation[],
    beneficiary: string
  ): Promise<ethers.TransactionResponse> {
    try {
      const packedUserOps = await Promise.all(
        userOps.map(async (op) => {
          const signed = await this.signUserOp(op);
          return this.packUserOp(signed);
        })
      );

      // Cast to any so TS does not complain about ABI-dynamic method
      const ep = this.entryPoint.connect(this.signer) as any;
      const tx = await ep.handleOps(packedUserOps, beneficiary);
      return tx as ethers.TransactionResponse;
    } catch (error) {
      logError("Error sending batch user operations:", error);
      throw error;
    }
  }

  /**
   * Builds a packed UserOperation in JSON-serializable form for client-side
   * EIP-712 signing. bigint fields are hex-encoded as strings.
   *
   * The returned object should be sent to the client, which signs it with
   * `wallet.signTypedData(domain, types, packedUserOp)` and sends the
   * signature back alongside the packed op.
   */
  async buildForClientSigning({
    sender,
    target,
    value,
    data,
    initCode = "0x",
  }: {
    sender: string;
    target: string;
    value: bigint;
    data: string;
    initCode?: string;
  }): Promise<PackedUserOpJson> {
    const userOp = await this.createUserOp({ sender, target, value, data, initCode });
    const packed = this.packUserOp(userOp);
    return {
      sender: packed.sender,
      nonce: ethers.toBeHex(packed.nonce),
      initCode: packed.initCode,
      callData: packed.callData,
      accountGasLimits: packed.accountGasLimits,
      preVerificationGas: ethers.toBeHex(packed.preVerificationGas),
      gasFees: packed.gasFees,
      paymasterAndData: packed.paymasterAndData,
    };
  }

  /**
   * Returns the EIP-712 domain and types needed by the client to sign a
   * packed UserOperation. Pass these alongside `buildForClientSigning` output.
   */
  getEip712Params(): {
    domain: ethers.TypedDataDomain;
    types: Record<string, ethers.TypedDataField[]>;
  } {
    return {
      domain: getErc4337TypedDataDomain(ENTRY_POINT_ADDRESS, CHAIN_ID),
      types: getErc4337TypedDataTypes(),
    };
  }

  /**
   * Submits one or more externally-signed packed UserOperations via
   * EntryPoint.handleOps. The gateway's own signer pays for the outer
   * transaction; the UserOp gas is covered by the Paymaster.
   *
   * @param signedOps - Packed UserOperations with `signature` already set
   * @returns Transaction response for the handleOps call
   */
  async submitSignedPacked(
    signedOps: Required<PackedUserOpJson>[]
  ): Promise<ethers.TransactionResponse> {
    const packed = signedOps.map((op) => ({
      sender: op.sender,
      nonce: BigInt(op.nonce),
      initCode: op.initCode,
      callData: op.callData,
      accountGasLimits: op.accountGasLimits,
      preVerificationGas: BigInt(op.preVerificationGas),
      gasFees: op.gasFees,
      paymasterAndData: op.paymasterAndData,
      signature: op.signature,
    }));
    const ep = this.entryPoint.connect(this.signer) as any;
    const tx = await ep.handleOps(packed, this.signer.address);
    return tx as ethers.TransactionResponse;
  }

  /**
   * Verifies that a handleOps transaction succeeded and tries to decode
   * revert reasons if it failed.
   *
   * This mirrors the logic from the original project and is mainly used
   * during development and debugging.
   *
   * @param receipt - Transaction receipt returned by ethers.js
   * @param targetContract - Contract interface used to parse custom errors
   * @throws {Error} If the user operation failed or logs cannot be interpreted
   */
  verifyTransaction(
    receipt: ethers.TransactionReceipt,
    targetContract: ethers.BaseContract
  ): void {
    const entryPoint = this.entryPoint;

    if (!receipt || !receipt.logs) {
      throw new Error("No receipt or logs found in transaction receipt.");
    }

    // Filter logs that look like UserOperationEvent
    const userOpEvents = receipt.logs.filter((log) => {
      try {
        const parsedLog = entryPoint.interface.parseLog(log as any);
        return parsedLog?.name === "UserOperationEvent";
      } catch {
        return false;
      }
    });

    if (userOpEvents.length === 0) {
      throw new Error("No UserOperationEvent found in transaction logs.");
    }

    let parsedUserOpEvent;
    try {
      const firstUserOpLog = userOpEvents[0];
      if (!firstUserOpLog) {
        throw new Error("No UserOperationEvent found in transaction logs.");
      }
      parsedUserOpEvent = entryPoint.interface.parseLog(firstUserOpLog as any);
    } catch (e) {
      throw new Error(
        "Failed to parse UserOperationEvent log: " +
          (e instanceof Error ? e.message : String(e))
      );
    }

    if (!parsedUserOpEvent?.args) {
      throw new Error("UserOperationEvent log missing args.");
    }

    const success = parsedUserOpEvent.args.success;

    if (!success) {
      // Look for revert reason events
      const revertEvents = receipt.logs.filter((log) => {
        try {
          const parsedLog = entryPoint.interface.parseLog(log as any);
          return parsedLog?.name === "UserOperationRevertReason";
        } catch {
          return false;
        }
      });

      if (revertEvents.length === 0) {
        throw new Error(
          "UserOperation failed but no UserOperationRevertReason found in logs."
        );
      }

      let parsedRevertEvent;
      try {
        const firstRevertLog = revertEvents[0];
        if (!firstRevertLog) {
          throw new Error(
            "UserOperation failed but no UserOperationRevertReason found in logs."
          );
        }
        parsedRevertEvent = entryPoint.interface.parseLog(firstRevertLog as any);
      } catch (e) {
        throw new Error(
          "Failed to parse UserOperationRevertReason log: " +
            (e instanceof Error ? e.message : String(e))
        );
      }

      if (!parsedRevertEvent?.args) {
        throw new Error("UserOperationRevertReason log missing args.");
      }

      const revertData = parsedRevertEvent.args.revertReason;

      const decodedError = targetContract.interface.parseError(revertData);
      if (decodedError) {
        throw new Error(
          `UserOperation reverted with custom error: ${
            decodedError.name
          }, args: ${JSON.stringify(decodedError.args)}`
        );
      } else {
        throw new Error("UserOperation reverted with unknown custom error.");
      }
    }
  }
}
