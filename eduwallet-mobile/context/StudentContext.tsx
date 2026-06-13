// context/StudentContext.tsx
import React, { createContext, useContext, useState, ReactNode } from "react";

/**
 * Lightweight authentication state for the current session.
 *
 * The student's identity (DID, SCA, VCs) lives in WalletContext which persists
 * across restarts. StudentContext only tracks whether the challenge-response
 * handshake has been completed this session.
 */
type StudentContextValue = {
  /** True after a successful challenge-response auth this session. */
  isAuthenticated: boolean;
  /** Mark the session as authenticated. */
  setAuthenticated: () => void;
  /** Clear the authentication state (e.g., on wallet reset). */
  clearAuthentication: () => void;
};

const StudentContext = createContext<StudentContextValue | undefined>(undefined);

export function StudentProvider({ children }: { children: ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  const setAuthenticated = () => setIsAuthenticated(true);
  const clearAuthentication = () => setIsAuthenticated(false);

  return (
    <StudentContext.Provider
      value={{ isAuthenticated, setAuthenticated, clearAuthentication }}
    >
      {children}
    </StudentContext.Provider>
  );
}

export function useStudent() {
  const ctx = useContext(StudentContext);
  if (!ctx) {
    throw new Error("useStudent must be used within a StudentProvider");
  }
  return ctx;
}
