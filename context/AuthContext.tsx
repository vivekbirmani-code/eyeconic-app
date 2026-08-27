import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api, getUserMessage } from '@/services/api';

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
  profilePicture?: string | null;
  isProfileComplete?: boolean;
  studentProfile?: StudentProfile;
  groups?: string[];
  unseenQuizzes?: string[];
  isFreeUser?: boolean;
  freeUserProfile?: {
    year?: string;
    issues?: string;
    resources?: string[];
    isReadyToTransform?: boolean;
  };
}

interface AuthContextType {
  user: User | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  refreshUser: () => Promise<void>;
  updateUser: (updates: Partial<User>) => void;
  isLoading: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    checkAuthStatus();
  }, []);

  const checkAuthStatus = async () => {
    try {
      const token = await AsyncStorage.getItem('authToken');
      if (token) {
        api.defaults.headers.Authorization = `Bearer ${token}`;
        const response = await api.get('/auth/me');
        setUser(response.data);
      }
    } catch (error) {
      await AsyncStorage.removeItem('authToken');
      delete api.defaults.headers.Authorization;
    } finally {
      setIsLoading(false);
    }
  };

  const login = async (email: string, password: string) => {
    try {
      const response = await api.post('/auth/login', { email, password });
      const { token, user } = response.data;

      await AsyncStorage.setItem('authToken', token);
      api.defaults.headers.Authorization = `Bearer ${token}`;
      setUser(user);
    } catch (error) {
      throw new Error(getUserMessage(error));
    }
  };

  const logout = async () => {
    await AsyncStorage.removeItem('authToken');
    delete api.defaults.headers.Authorization;
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

  const updateUser = (updates: Partial<User>) => {
    setUser((current) => (current ? { ...current, ...updates } : current));
  };

  return (
    <AuthContext.Provider value={{ user, login, logout, refreshUser, updateUser, isLoading }}>
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