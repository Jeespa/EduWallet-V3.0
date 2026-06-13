import React, { createContext, useContext, useEffect, useState } from "react";
import * as SecureStore from "expo-secure-store";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { ethers } from "ethers";
import * as Crypto from "expo-crypto";
import { deriveDidKey } from "../lib/did";

// Storage keys
const SK_PRIVATE_KEY = "eduwallet_pk";
const SK_DID = "eduwallet_did";
const SK_OWNER_ADDR = "eduwallet_owner_addr";
const SK_KYC_VC = "eduwallet_kyc_vc";
const SK_STUDENT_STATUS_VC = "eduwallet_student_status_vc";
const SK_SCA_ADDRESS = "eduwallet_sca_address";
const SK_ACADEMIC_VCS = "eduwallet_academic_vcs";

// Thin wrapper: uses SecureStore on native, AsyncStorage as fallback on web /
// environments where the native module is not registered (e.g. Expo Go on web).
const secureStorage = {
  async set(key: string, value: string): Promise<void> {
    try {
      if (await SecureStore.isAvailableAsync()) {
        await SecureStore.setItemAsync(key, value);
      } else {
        await AsyncStorage.setItem(key, value);
      }
    } catch {
      await AsyncStorage.setItem(key, value);
    }
  },
  async get(key: string): Promise<string | null> {
    try {
      if (await SecureStore.isAvailableAsync()) {
        return await SecureStore.getItemAsync(key);
      }
      return await AsyncStorage.getItem(key);
    } catch {
      return AsyncStorage.getItem(key);
    }
  },
  async delete(key: string): Promise<void> {
    try {
      if (await SecureStore.isAvailableAsync()) {
        await SecureStore.deleteItemAsync(key);
      } else {
        await AsyncStorage.removeItem(key);
      }
    } catch {
      await AsyncStorage.removeItem(key);
    }
  },
};

interface WalletContextValue {
  /** Student's did:key identifier, null until wallet is created. */
  did: string | null;
  /** EOA address derived from the keypair, null until wallet is created. */
  ownerAddress: string | null;
  /** True while the context is reading persisted state from storage. */
  isLoading: boolean;
  /** Convenience flag: true when a wallet has been created and loaded. */
  hasWallet: boolean;
  /** SD-JWT KYC credential string, null until KYC is completed. */
  kycVc: string | null;
  /** Convenience flag: true when a KYC VC is stored. */
  hasKycVc: boolean;
  /** SD-JWT StudentStatus credential string, null until academic wallet is activated. */
  studentStatusVc: string | null;
  /** Convenience flag: true when a StudentStatus VC is stored. */
  hasStudentStatusVc: boolean;
  /** On-chain smart contract account address, null until deployed. */
  scaAddress: string | null;
  /** Generate a new keypair, persist it, and return the new WalletInfo. */
  createWallet: () => Promise<{ did: string; ownerAddress: string }>;
  /** Persist an SD-JWT KYC VC received from the gateway. */
  storeKycVc: (vc: string) => Promise<void>;
  /** Persist a StudentStatus VC and the deployed SCA address. */
  storeStudentStatus: (vc: string, sca: string) => Promise<void>;
  /** Array of AcademicResult SD-JWT VCs, one per issued credential. */
  academicVcs: string[];
  /** Convenience flag: true when at least one AcademicResult VC is stored. */
  hasAcademicVcs: boolean;
  /** Append a new AcademicResult VC to the stored list. */
  storeAcademicVc: (vc: string) => Promise<void>;
  /** Sign an arbitrary message with the stored private key. */
  signMessage: (message: string) => Promise<string>;
  /** Sign EIP-712 typed data with the stored private key (for UserOp signing). */
  signTypedData: (
    domain: Record<string, unknown>,
    types: Record<string, Array<{ name: string; type: string }>>,
    value: Record<string, unknown>
  ) => Promise<string>;
  /** Wipe all wallet data from storage (logout / reset). */
  clearWallet: () => Promise<void>;
}

const WalletContext = createContext<WalletContextValue | null>(null);

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [did, setDid] = useState<string | null>(null);
  const [ownerAddress, setOwnerAddress] = useState<string | null>(null);
  const [kycVc, setKycVc] = useState<string | null>(null);
  const [studentStatusVc, setStudentStatusVc] = useState<string | null>(null);
  const [scaAddress, setScaAddress] = useState<string | null>(null);
  const [academicVcs, setAcademicVcs] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // On mount: restore wallet metadata from AsyncStorage (non-sensitive).
  // The private key stays in SecureStore and is never placed in React state.
  useEffect(() => {
    (async () => {
      try {
        const [storedDid, storedAddr, storedVc, storedStudentVc, storedSca, storedAcademicRaw] =
          await Promise.all([
            AsyncStorage.getItem(SK_DID),
            AsyncStorage.getItem(SK_OWNER_ADDR),
            AsyncStorage.getItem(SK_KYC_VC),
            AsyncStorage.getItem(SK_STUDENT_STATUS_VC),
            AsyncStorage.getItem(SK_SCA_ADDRESS),
            AsyncStorage.getItem(SK_ACADEMIC_VCS),
          ]);
        setDid(storedDid);
        setOwnerAddress(storedAddr);
        setKycVc(storedVc);
        setStudentStatusVc(storedStudentVc);
        setScaAddress(storedSca);
        setAcademicVcs(storedAcademicRaw ? (JSON.parse(storedAcademicRaw) as string[]) : []);
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  const createWallet = async (): Promise<{
    did: string;
    ownerAddress: string;
  }> => {
    // Use expo-crypto for CSPRNG — guaranteed to work in Hermes / JSC
    const randomBytes = await Crypto.getRandomBytesAsync(32);
    const privateKeyHex = ethers.hexlify(randomBytes);
    const wallet = new ethers.Wallet(privateKeyHex);

    const newDid = deriveDidKey(wallet.signingKey.compressedPublicKey);
    const address = wallet.address;

    // Private key → secure enclave (AsyncStorage fallback on web)
    await secureStorage.set(SK_PRIVATE_KEY, privateKeyHex);
    await AsyncStorage.multiSet([
      [SK_DID, newDid],
      [SK_OWNER_ADDR, address],
    ]);

    setDid(newDid);
    setOwnerAddress(address);

    return { did: newDid, ownerAddress: address };
  };

  const storeKycVc = async (vc: string): Promise<void> => {
    await AsyncStorage.setItem(SK_KYC_VC, vc);
    setKycVc(vc);
  };

  const storeStudentStatus = async (vc: string, sca: string): Promise<void> => {
    await AsyncStorage.multiSet([
      [SK_STUDENT_STATUS_VC, vc],
      [SK_SCA_ADDRESS, sca],
    ]);
    setStudentStatusVc(vc);
    setScaAddress(sca);
  };

  const storeAcademicVc = async (vc: string): Promise<void> => {
    const updated = [...academicVcs, vc];
    await AsyncStorage.setItem(SK_ACADEMIC_VCS, JSON.stringify(updated));
    setAcademicVcs(updated);
  };

  const signMessage = async (message: string): Promise<string> => {
    const pk = await secureStorage.get(SK_PRIVATE_KEY);
    if (!pk) throw new Error("No wallet found — create a wallet first");
    return new ethers.Wallet(pk).signMessage(message);
  };

  const signTypedData = async (
    domain: Record<string, unknown>,
    types: Record<string, Array<{ name: string; type: string }>>,
    value: Record<string, unknown>
  ): Promise<string> => {
    const pk = await secureStorage.get(SK_PRIVATE_KEY);
    if (!pk) throw new Error("No wallet found — create a wallet first");
    return new ethers.Wallet(pk).signTypedData(
      domain as Parameters<ethers.Wallet["signTypedData"]>[0],
      types as Parameters<ethers.Wallet["signTypedData"]>[1],
      value
    );
  };

  const clearWallet = async () => {
    await secureStorage.delete(SK_PRIVATE_KEY);
    await AsyncStorage.multiRemove([
      SK_DID,
      SK_OWNER_ADDR,
      SK_KYC_VC,
      SK_STUDENT_STATUS_VC,
      SK_SCA_ADDRESS,
      SK_ACADEMIC_VCS,
    ]);
    setDid(null);
    setOwnerAddress(null);
    setKycVc(null);
    setStudentStatusVc(null);
    setScaAddress(null);
    setAcademicVcs([]);
  };

  return (
    <WalletContext.Provider
      value={{
        did,
        ownerAddress,
        isLoading,
        hasWallet: !!did,
        kycVc,
        hasKycVc: !!kycVc,
        studentStatusVc,
        hasStudentStatusVc: !!studentStatusVc,
        scaAddress,
        createWallet,
        storeKycVc,
        storeStudentStatus,
        academicVcs,
        hasAcademicVcs: academicVcs.length > 0,
        storeAcademicVc,
        signMessage,
        signTypedData,
        clearWallet,
      }}
    >
      {children}
    </WalletContext.Provider>
  );
}

export function useWallet(): WalletContextValue {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used inside WalletProvider");
  return ctx;
}
