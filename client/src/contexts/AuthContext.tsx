import { createContext, useContext, useState, useEffect } from 'react';
import type { ReactNode } from 'react';
import { api, getUserMessage } from '../services/api';

interface StudentProfile {
  mbbsBatch?: string;
  collegeName?: string;
  attemptNo?: number;
  batchType?: string;
  grandTestsGiven?: string;
  averageCorrects?: string;
  averageScore?: number;
  weakestSubjects?: string;
  targetBranch?: string;
  subscriptions?: string;
}

interface User {
  _id: string;
  name: string;
  email: string;
  phone?: string;
  role: string;
  isProfileComplete?: boolean;
  studentProfile?: StudentProfile;
  groups?: string[];
}

interface AuthContextType {
  user: User | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  refreshUser: () => Promise<void>;
  isLoading: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    checkAuthStatus();
    
    // Listen for unauthorized events from api interceptor
    const handleUnauthorized = () => {
      setUser(null);
    };
    window.addEventListener('unauthorizedUser', handleUnauthorized);
    return () => window.removeEventListener('unauthorizedUser', handleUnauthorized);
  }, []);

  const checkAuthStatus = async () => {
    try {
      const token = localStorage.getItem('userToken');
      if (token) {
        api.defaults.headers.common['Authorization'] = `Bearer ${token}`;
        const response = await api.get('/auth/me');
        setUser(response.data);
      }
    } catch (error) {
      localStorage.removeItem('userToken');
      delete api.defaults.headers.common['Authorization'];
    } finally {
      setIsLoading(false);
    }
  };

  const login = async (email: string, password: string) => {
    try {
      const response = await api.post('/auth/login', { email, password });
      const { token, user } = response.data;

      localStorage.setItem('userToken', token);
      api.defaults.headers.common['Authorization'] = `Bearer ${token}`;
      setUser(user);
    } catch (error) {
      throw new Error(getUserMessage(error));
    }
  };

  const logout = () => {
    localStorage.removeItem('userToken');
    delete api.defaults.headers.common['Authorization'];
    setUser(null);
  };

  const refreshUser = async () => {
    try {
      const response = await api.get('/auth/me');
      setUser(response.data);
    } catch (error) {
      console.error('Failed to refresh user:', error);
    }
  };

  return (
    <AuthContext.Provider value={{ user, login, logout, refreshUser, isLoading }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
