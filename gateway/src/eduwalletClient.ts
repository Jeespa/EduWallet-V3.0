/**
 * EduWalletClient
 *
 * Provides read-only access to on-chain student permission data for the HTTP
 * gateway. Credential-based (PBKDF2) methods were removed; all mutation
 * paths now use client-side keypair signing via the AccountAbstraction helper.
 */

import { JsonRpcProvider, Contract, id } from "ethers";

import { University__factory } from "../../typechain-types/factories/contracts/University__factory";

import type {
  AllPermissionsForStudent,
  UniversityPermissionEntry,
} from "./types";
import { RPC_URL } from "./config";

const STUDENT_OWNER_ABI = [
  "function getPermissions(bytes32 permissionType) external view returns (address[])",
];

const provider = new JsonRpcProvider(RPC_URL);

const roleCodes = {
  readRequest: id("READER_APPLICANT"),
  writeRequest: id("WRITER_APPLICANT"),
  read: id("READER_ROLE"),
  write: id("WRITER_ROLE"),
};

async function fetchUniversitiesMeta(
  addresses: string[]
): Promise<Map<string, { name: string; country: string; shortName: string }>> {
  const unique = Array.from(
    new Set(
      addresses.filter(
        (a) =>
          a &&
          a !== "0x0000000000000000000000000000000000000000" &&
          a.startsWith("0x")
      )
    )
  );

  const map = new Map<
    string,
    { name: string; country: string; shortName: string }
  >();

  for (const addr of unique) {
    try {
      const uniContract = University__factory.connect(addr, provider as any);
      const info = await uniContract.getUniversityInfo();
      map.set(addr, {
        name: info.name,
        country: info.country,
        shortName: info.shortName,
      });
    } catch (err) {
      console.error("Failed to fetch university info for", addr, err);
    }
  }

  return map;
}

export class EduWalletClient {
  /**
   * Reads all permission sets for a student SCA without requiring student
   * credentials. Uses view functions on the Student contract directly.
   *
   * @param studentSca - Address of the student smart account.
   */
  async getAllPermissionsReadOnly(
    studentSca: string
  ): Promise<AllPermissionsForStudent> {
    if (!studentSca || !studentSca.startsWith("0x")) {
      throw new Error("Valid student smart account address is required");
    }

    const studentContract = new Contract(studentSca, STUDENT_OWNER_ABI, provider);

    const callRole = async (role: string): Promise<string[]> => {
      try {
        const result = await (studentContract as any).getPermissions(role);
        return Array.from(result as string[]);
      } catch {
        return [];
      }
    };

    const [read, write, readRequested, writeRequested] = await Promise.all([
      callRole(roleCodes.read),
      callRole(roleCodes.write),
      callRole(roleCodes.readRequest),
      callRole(roleCodes.writeRequest),
    ]);

    const allAddrs = Array.from(
      new Set<string>([...read, ...write, ...readRequested, ...writeRequested])
    );
    const uniMetaMap = await fetchUniversitiesMeta(allAddrs);

    const permissions: UniversityPermissionEntry[] = allAddrs
      .filter(
        (addr) =>
          addr &&
          addr !== "0x0000000000000000000000000000000000000000" &&
          addr.startsWith("0x")
      )
      .map((addr) => {
        const meta = uniMetaMap.get(addr) ?? {
          name: "",
          country: "",
          shortName: "",
        };
        return {
          universityAddress: addr,
          read: read.includes(addr),
          write: write.includes(addr),
          readRequested: readRequested.includes(addr),
          writeRequested: writeRequested.includes(addr),
          universityName: meta.name,
          universityCountry: meta.country,
          universityShortName: meta.shortName,
        };
      });

    return { studentSca, permissions };
  }
}
