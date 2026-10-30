import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { clearLocalUserData } from '../utils/sync';
import { restoreSession } from '../e2ee/auth';
import { setSession, hasSession } from '../e2ee/session';

interface User {
  id: string;
  username: string;
  email?: string;
  isAdmin?: boolean;
  plan?: string;
  e2ee_version?: number;
  kdf_version?: number;
  master_key_encrypted?: string | null;
  public_key?: string | null;
  private_key_encrypted?: string | null;
  calendar_key_encrypted?: string | null;
  server_calendar_sync?: boolean;
}

interface AuthContextType {
  user: User | null;
  token: string | null;
  masterKey: string | null;
  isVaultLocked: boolean;
  login: (token: string, user: User) => void;
  logout: () => void;
  setMasterKey: (key: string) => void;
  loading: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(localStorage.getItem('token'));
  const [masterKey, setMasterKeyState] = useState<string | null>(sessionStorage.getItem('master_key'));
  const [loading, setLoading] = useState(true);

  // Locked = signed in, but this tab doesn't hold the master key (new tab / browser restart). The user re-enters their password.
  const isVaultLocked = !!(user && (user.public_key || user.master_key_encrypted) && !masterKey);

  const setMasterKey = (key: string) => {
    sessionStorage.setItem('master_key', key);
    setMasterKeyState(key);
  };

  useEffect(() => {
    if (!token) { setLoading(false); return; }
    setLoading(true);
    fetch('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => {
        if (res.ok) return res.json();
        throw new Error('Invalid token');
      })
      .then(async (data) => {
        // Re-create the in-memory key session from the tab's stored master key before any page loads data.
        const mk = sessionStorage.getItem('master_key');
        if (mk && !hasSession()) await restoreSession(token, data.user, mk);
        setUser(data.user);
      })
      .catch(() => { logout(); })
      .finally(() => { setLoading(false); });
  }, [token]);

  const login = (newToken: string, newUser: User) => {
    localStorage.setItem('token', newToken);
    setToken(newToken);
    setUser(newUser);
  };

  const logout = () => {
    void clearLocalUserData();
    setSession(null);
    localStorage.removeItem('token');
    sessionStorage.removeItem('master_key');
    setToken(null);
    setUser(null);
    setMasterKeyState(null);
  };

  return (
    <AuthContext.Provider value={{ user, token, masterKey, isVaultLocked, login, logout, setMasterKey, loading }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
