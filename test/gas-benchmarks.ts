/**
 * Gas Cost Benchmarks — EduWallet V3.0
 *
 * Measures on-chain gas consumption for every write operation in the system.
 * Each `it()` block performs exactly one transaction so hardhat-gas-reporter
 * produces a clean per-method table.
 *
 * Run:
 *   REPORT_GAS=true npx hardhat test test/gas-benchmarks.ts
 *
 * The reporter writes gas-report.txt and prints a summary table.
 * These numbers feed directly into the thesis evaluation chapter.
 *
 * Notes on methodology
 * --------------------
 * - Tests run on Hardhat's in-process EVM (no network overhead).
 * - Optimizer: enabled, 1000 runs (matches production config).
 * - Student.grantPermission / revokePermission require msg.sender == address(this)
 *   (DEFAULT_ADMIN_ROLE is held by the contract itself so that only ERC-4337
 *   UserOps routed through the contract can mutate permissions).
 *   We impersonate the contract's own address to isolate the pure call gas cost,
 *   which equals what an AA UserOp's inner call would cost.
 * - ethers.ZeroAddress is used for the EntryPoint parameter wherever the
 *   constructor only stores it (no interaction during benchmarked operations).
 */

import { expect } from "chai";
import { ethers, network } from "hardhat";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

// ── helpers ───────────────────────────────────────────────────────────────────

const TEST_DID_KEY = "did:key:zQ3shZxBiP5i8nVm2ZKfXTGPE4p2kZNa8bAJjKczmySvnNFrf";
const DID_KEY_HASH  = ethers.keccak256(ethers.toUtf8Bytes(TEST_DID_KEY));

/** Fund and impersonate an address so we can call onlyRole(DEFAULT_ADMIN_ROLE) */
async function impersonate(addr: string): Promise<HardhatEthersSigner> {
  await network.provider.send("hardhat_setBalance", [
    addr,
    "0x1000000000000000000", // 1 ETH
  ]);
  await network.provider.send("hardhat_impersonateAccount", [addr]);
  return ethers.getSigner(addr);
}

async function stopImpersonate(addr: string): Promise<void> {
  await network.provider.send("hardhat_stopImpersonatingAccount", [addr]);
}

// ── VCStatusRegistry ──────────────────────────────────────────────────────────

describe("Gas: VCStatusRegistry", function () {
  it("deploy", async function () {
    const F = await ethers.getContractFactory("VCStatusRegistry");
    await F.deploy();
  });

  it("register(credentialId)  — first registration", async function () {
    const F = await ethers.getContractFactory("VCStatusRegistry");
    const reg = await F.deploy();
    const id = ethers.keccak256(ethers.toUtf8Bytes("urn:uuid:benchmark-001"));
    await reg.register(id);
  });

  it("revoke(credentialId)", async function () {
    const F = await ethers.getContractFactory("VCStatusRegistry");
    const reg = await F.deploy();
    const id = ethers.keccak256(ethers.toUtf8Bytes("urn:uuid:benchmark-002"));
    await reg.register(id);
    await reg.revoke(id);
    expect(await reg.isRevoked(id)).to.equal(true);
  });

  it("isRevoked(credentialId)  — view, called via eth_call (0 gas to caller)", async function () {
    const F = await ethers.getContractFactory("VCStatusRegistry");
    const reg = await F.deploy();
    const id = ethers.keccak256(ethers.toUtf8Bytes("urn:uuid:benchmark-003"));
    // This is a staticcall — gas reporter shows 0 for the caller.
    // EVM internally uses ~2 300 gas but that is not charged to a caller.
    const result = await reg.isRevoked(id);
    expect(result).to.equal(false);
  });
});

// ── StudentDeployer ───────────────────────────────────────────────────────────

describe("Gas: StudentDeployer", function () {
  it("deploy StudentDeployer contract", async function () {
    const F = await ethers.getContractFactory("StudentDeployer");
    await F.deploy();
  });

  it("deploy(student)  — CREATE2 counterfactual deployment", async function () {
    const [, university, student] = await ethers.getSigners();
    const F  = await ethers.getContractFactory("StudentDeployer");
    const sd = await F.deploy();
    await sd.deploy(
      university.address,
      student.address,
      DID_KEY_HASH,
      ethers.ZeroAddress,
    );
  });

  it("computeAddress(student)  — view, 0 gas to caller", async function () {
    const [, university, student] = await ethers.getSigners();
    const F  = await ethers.getContractFactory("StudentDeployer");
    const sd = await F.deploy();
    const addr = await sd.computeAddress(
      university.address,
      student.address,
      DID_KEY_HASH,
      ethers.ZeroAddress,
    );
    expect(ethers.isAddress(addr)).to.equal(true);
  });
});

// ── Student — permission management ──────────────────────────────────────────

describe("Gas: Student — permission management", function () {
  let student: Awaited<ReturnType<typeof ethers.getContractAt>>;
  let universityAddr: string;
  let studentAddr: string;

  beforeEach(async function () {
    const [, uni, stu] = await ethers.getSigners();
    universityAddr = uni.address;
    studentAddr    = stu.address;

    const F = await ethers.getContractFactory("Student");
    student = await F.deploy(
      universityAddr,
      studentAddr,
      DID_KEY_HASH,
      ethers.ZeroAddress,
    );
  });

  it("askForPermission(READER_APPLICANT)  — external university requests read", async function () {
    const [, , , third] = await ethers.getSigners();
    const READER_APPLICANT = ethers.id("READER_APPLICANT");
    await (student as any).connect(third).askForPermission(READER_APPLICANT);
  });

  it("askForPermission(WRITER_APPLICANT)  — external university requests write", async function () {
    const [, , , third] = await ethers.getSigners();
    const WRITER_APPLICANT = ethers.id("WRITER_APPLICANT");
    await (student as any).connect(third).askForPermission(WRITER_APPLICANT);
  });

  it("grantPermission(READER_ROLE, university)  — student grants read access", async function () {
    // DEFAULT_ADMIN_ROLE is held by address(this). Impersonate the contract
    // to reproduce the gas cost of the inner call made by the AA execute path.
    const [, , , third] = await ethers.getSigners();
    const contractAddr = await student.getAddress();
    const self = await impersonate(contractAddr);

    const READER_ROLE = ethers.id("READER_ROLE");
    await (student as any).connect(self).grantPermission(READER_ROLE, third.address);

    await stopImpersonate(contractAddr);
  });

  it("grantPermission(WRITER_ROLE, university)  — student grants write access", async function () {
    const [, , , third] = await ethers.getSigners();
    const contractAddr = await student.getAddress();
    const self = await impersonate(contractAddr);

    const WRITER_ROLE = ethers.id("WRITER_ROLE");
    await (student as any).connect(self).grantPermission(WRITER_ROLE, third.address);

    await stopImpersonate(contractAddr);
  });

  it("revokePermission(university)  — student revokes existing access", async function () {
    // The constructor already grants WRITER_ROLE to universityAddr
    const contractAddr = await student.getAddress();
    const self = await impersonate(contractAddr);

    await (student as any).connect(self).revokePermission(universityAddr);

    await stopImpersonate(contractAddr);
  });
});

// ── Student — academic records ────────────────────────────────────────────────

describe("Gas: Student — academic records", function () {
  let student: Awaited<ReturnType<typeof ethers.getContractAt>>;
  let university: HardhatEthersSigner;

  beforeEach(async function () {
    const [, uni, stu] = await ethers.getSigners();
    university = uni;

    const F = await ethers.getContractFactory("Student");
    student = await F.deploy(
      uni.address,
      stu.address,
      DID_KEY_HASH,
      ethers.ZeroAddress,
    );
  });

  it("enroll  — 1 course", async function () {
    await (student as any).connect(university).enroll([
      {
        code: "TMA4100",
        name: "Distributed Systems",
        degreeCourse: "MSc Computer Engineering",
        ects: 1000, // 10.0 ECTS × 100
      },
    ]);
  });

  it("enroll  — 5 courses (batch)", async function () {
    const courses = Array.from({ length: 5 }, (_, i) => ({
      code: `COURSE${i + 1}`,
      name: `Course ${i + 1}`,
      degreeCourse: "MSc Computer Engineering",
      ects: 600,
    }));
    await (student as any).connect(university).enroll(courses);
  });

  it("evaluate  — 1 course", async function () {
    await (student as any).connect(university).enroll([
      { code: "TMA4100", name: "Distributed Systems", degreeCourse: "MSc CE", ects: 1000 },
    ]);
    await (student as any).connect(university).evaluate([
      { code: "TMA4100", grade: "B", date: 1748736000, certificateHash: "" },
    ]);
  });

  it("evaluate  — 1 course with IPFS certificate hash", async function () {
    await (student as any).connect(university).enroll([
      { code: "TMA4100", name: "Distributed Systems", degreeCourse: "MSc CE", ects: 1000 },
    ]);
    await (student as any).connect(university).evaluate([
      {
        code: "TMA4100",
        grade: "B",
        date: 1748736000,
        certificateHash: "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi",
      },
    ]);
  });
});
