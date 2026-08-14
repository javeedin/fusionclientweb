export interface User {
  id: string;
  username: string;
  name: string;
  email: string;
  role: string;
  photo?: string; // base64 data URL
  isAdmin?: boolean;
  modules?: string[];  // module codes assigned
  bus?: Array<{ id: number; name: string }>;
  company?: string; // company code (e.g., MITSUMI, GRAYSINC)
}

export type LoginStatus =
  | 'SUCCESS' | 'INVALID_USER' | 'WRONG_PASSWORD'
  | 'LOCKED'  | 'SUSPENDED'   | 'NO_PASSWORD' | 'ERROR';

export interface LoginResult {
  status: LoginStatus;
  message: string;
}

export interface AuthContextType {
  user: User | null;
  setUser: (user: User | null) => void;
  isAuthenticated: boolean;
  login: (username: string, password: string) => Promise<boolean>;
  loginWithStatus: (username: string, password: string) => Promise<LoginResult>;
  sendOtp: (username: string) => Promise<{ status: string; message: string }>;
  setPassword: (username: string, otp: string, newPassword: string) => Promise<{ status: string; message: string }>;
  uploadPhoto: (username: string, base64: string, mimeType: string) => Promise<{ status: string; message: string }>;
  changePassword: (username: string, currentPassword: string, newPassword: string) => Promise<{ status: string; message: string }>;
  logout: () => void;
}

export interface Module {
  id: string;
  name: string;
  description: string;
  icon: React.ReactNode;
  path: string;
  color: string;
}

export interface MenuItem {
  key: string;
  label: string;
  icon?: React.ReactNode;
  children?: MenuItem[];
  path?: string;
}
