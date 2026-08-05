import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { can, type Permission, type UserRole } from "../lib/auth/permissions";
import {
  closeCompany,
  createCompany,
  listCompanies,
  openCompany,
  updateCompanyGstSettings,
  type CompanyRecord,
} from "../lib/db/client";
import { setCurrentUser } from "../lib/db/session";
import {
  authenticate,
  countUsers,
  setupOwner,
  type AppUser,
} from "../lib/db/users";

type AuthGate = "none" | "setup" | "login";

interface AppContextValue {
  ready: boolean;
  companies: CompanyRecord[];
  company: CompanyRecord | null;
  user: AppUser | null;
  authGate: AuthGate;
  error: string | null;
  refreshCompanies: () => Promise<void>;
  selectCompany: (company: CompanyRecord) => Promise<void>;
  addCompany: (input: {
    name: string;
    fyStart?: string;
    stateCode?: string;
    gstin?: string;
    gstEnabled?: boolean;
    ownerUsername: string;
    ownerPassword: string;
    ownerDisplayName?: string;
  }) => Promise<CompanyRecord>;
  saveGstSettings: (input: {
    gstEnabled: boolean;
    stateCode: string;
    gstin: string;
  }) => Promise<void>;
  login: (username: string, password: string) => Promise<void>;
  completeOwnerSetup: (input: {
    username: string;
    password: string;
    displayName?: string;
  }) => Promise<void>;
  leaveCompany: () => Promise<void>;
  logout: () => void;
  allowed: (perm: Permission) => boolean;
}

const AppContext = createContext<AppContextValue | null>(null);

const STORAGE_KEY = "kite.activeCompanyId";
const USER_KEY = "kite.activeUserId";

export function AppProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [companies, setCompanies] = useState<CompanyRecord[]>([]);
  const [company, setCompany] = useState<CompanyRecord | null>(null);
  const [user, setUser] = useState<AppUser | null>(null);
  const [authGate, setAuthGate] = useState<AuthGate>("none");
  const [error, setError] = useState<string | null>(null);

  const clearSession = useCallback(() => {
    setUser(null);
    setCurrentUser(null);
    localStorage.removeItem(USER_KEY);
  }, []);

  const refreshCompanies = useCallback(async () => {
    const rows = await listCompanies();
    setCompanies(rows);
    setCompany((current) => {
      if (!current) return current;
      return rows.find((c) => c.id === current.id) || current;
    });
  }, []);

  const evaluateAuthGate = useCallback(async () => {
    const n = await countUsers();
    if (n === 0) {
      clearSession();
      setAuthGate("setup");
      return;
    }
    setAuthGate("login");
    clearSession();
  }, [clearSession]);

  const selectCompany = useCallback(
    async (record: CompanyRecord) => {
      await openCompany(record);
      setCompany(record);
      localStorage.setItem(STORAGE_KEY, record.id);
      await evaluateAuthGate();
    },
    [evaluateAuthGate],
  );

  const addCompany = useCallback(
    async (input: {
      name: string;
      fyStart?: string;
      stateCode?: string;
      gstin?: string;
      gstEnabled?: boolean;
      ownerUsername: string;
      ownerPassword: string;
      ownerDisplayName?: string;
    }) => {
      const created = await createCompany(input);
      const owner = await setupOwner({
        username: input.ownerUsername,
        password: input.ownerPassword,
        displayName: input.ownerDisplayName || input.ownerUsername,
      });
      setCompany(created);
      setUser(owner);
      setCurrentUser(owner);
      setAuthGate("none");
      localStorage.setItem(STORAGE_KEY, created.id);
      localStorage.setItem(USER_KEY, String(owner.id));
      await refreshCompanies();
      return created;
    },
    [refreshCompanies],
  );

  const login = useCallback(async (username: string, password: string) => {
    const u = await authenticate(username, password);
    setUser(u);
    setCurrentUser(u);
    setAuthGate("none");
    localStorage.setItem(USER_KEY, String(u.id));
  }, []);

  const completeOwnerSetup = useCallback(
    async (input: {
      username: string;
      password: string;
      displayName?: string;
    }) => {
      const owner = await setupOwner({
        username: input.username,
        password: input.password,
        displayName: input.displayName || input.username,
      });
      setUser(owner);
      setCurrentUser(owner);
      setAuthGate("none");
      localStorage.setItem(USER_KEY, String(owner.id));
    },
    [],
  );

  const saveGstSettings = useCallback(
    async (input: {
      gstEnabled: boolean;
      stateCode: string;
      gstin: string;
    }) => {
      if (!company) throw new Error("No company open");
      if (!can(user?.role as UserRole, "manage_company")) {
        throw new Error("You do not have permission to change GST settings.");
      }
      const updated = await updateCompanyGstSettings({
        companyId: company.id,
        ...input,
      });
      setCompany(updated);
      await refreshCompanies();
    },
    [company, refreshCompanies, user],
  );

  const leaveCompany = useCallback(async () => {
    await closeCompany();
    setCompany(null);
    clearSession();
    setAuthGate("none");
    localStorage.removeItem(STORAGE_KEY);
  }, [clearSession]);

  const logout = useCallback(() => {
    clearSession();
    if (company) setAuthGate("login");
  }, [clearSession, company]);

  const allowed = useCallback(
    (perm: Permission) => can(user?.role as UserRole, perm),
    [user],
  );

  useEffect(() => {
    (async () => {
      try {
        await refreshCompanies();
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
          const rows = await listCompanies();
          const match = rows.find((c) => c.id === saved);
          if (match) await selectCompany(match);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setReady(true);
      }
    })();
  }, [refreshCompanies, selectCompany]);

  const value = useMemo(
    () => ({
      ready,
      companies,
      company,
      user,
      authGate,
      error,
      refreshCompanies,
      selectCompany,
      addCompany,
      saveGstSettings,
      login,
      completeOwnerSetup,
      leaveCompany,
      logout,
      allowed,
    }),
    [
      ready,
      companies,
      company,
      user,
      authGate,
      error,
      refreshCompanies,
      selectCompany,
      addCompany,
      saveGstSettings,
      login,
      completeOwnerSetup,
      leaveCompany,
      logout,
      allowed,
    ],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used within AppProvider");
  return ctx;
}
