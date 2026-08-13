import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import type { User, AuthContextType, LoginResult } from '../types';

const APEX_AUTH_BASE = 'https://g15d6279501ae08-buimerc.adb.me-dubai-1.oraclecloudapps.com/ords/bcldifc/reerp/auth';
const APEX_ADMIN_BASE = 'https://g15d6279501ae08-buimerc.adb.me-dubai-1.oraclecloudapps.com/ords/bcldifc/reerp/admin';


const isElectron = !!(window as any).electronAPI?.isElectron;

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(() => {
    // In Electron the file-based session is loaded asynchronously below;
    // start with localStorage as a fast synchronous fallback.
    try {
      const saved = localStorage.getItem('erp_user');
      return saved ? JSON.parse(saved) : null;
    } catch { return null; }
  });

  // On Electron startup, load the file-based session (overrides localStorage result
  // because it's more reliable — Chromium's quota DB can fail on some Windows machines).
  useEffect(() => {
    if (!isElectron) return;
    (window as any).electronAPI.getErpSession().then((session: { user: User; token: string } | null) => {
      if (session?.user) {
        setUser(session.user);
        // Keep localStorage in sync for the synchronous initializer
        try { localStorage.setItem('erp_user', JSON.stringify(session.user)); } catch { /* ignore */ }
        try { localStorage.setItem('erp_token', session.token || ''); } catch { /* ignore */ }
      }
    }).catch(() => { /* ignore */ });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const loginWithStatus = useCallback(async (username: string, password: string): Promise<LoginResult> => {
    try {
      const res = await fetch(`${APEX_AUTH_BASE}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();

      if (data.status === 'SUCCESS') {
        const uname = data.user?.username || username;
        const userData: User = {
          id: uname,
          username: uname,
          name: data.user?.name || username,
          email: data.user?.email || username,
          role: 'User',
        };
        // Load profile photo
        try {
          const photoRes = await fetch(`${APEX_AUTH_BASE}/profile-photo/${encodeURIComponent(uname)}`);
          const photoData = await photoRes.json();
          if (photoData.status === 'OK' && photoData.photo) {
            userData.photo = `data:${photoData.mime_type};base64,${photoData.photo}`;
          }
        } catch { /* photo is optional */ }

        // Load user access (isAdmin, modules, bus)
        try {
          const accessRes = await fetch(`${APEX_ADMIN_BASE}/user-access/${encodeURIComponent(uname)}`);
          const accessData = await accessRes.json();
          if (accessData.status === 'SUCCESS') {
            userData.isAdmin  = accessData.data?.is_admin === 'Y';
            userData.modules  = accessData.data?.modules  || [];
            userData.bus      = accessData.data?.bus       || [];
          }
        } catch { /* access is optional */ }

        setUser(userData);
        localStorage.setItem('erp_user', JSON.stringify(userData));
        localStorage.setItem('erp_token', data.token || '');
        if (isElectron) {
          (window as any).electronAPI.saveErpSession(userData, data.token || '').catch(() => {});
        }
      }

      return { status: data.status, message: data.message || '' };
    } catch {
      return { status: 'ERROR', message: 'Unable to connect. Please check your internet connection.' };
    }
  }, []);

  const login = useCallback(async (username: string, password: string): Promise<boolean> => {
    const result = await loginWithStatus(username, password);
    return result.status === 'SUCCESS';
  }, [loginWithStatus]);

  const sendOtpViaBrowser = async (to: string, otp: string): Promise<{ success: boolean; error?: string }> => {
    try {
      const res = await fetch('http://localhost:3001/api/send-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to, otp }),
      });
      return await res.json();
    } catch (e: unknown) {
      return { success: false, error: e instanceof Error ? e.message : 'Email send failed.' };
    }
  };

  const sendOtp = useCallback(async (username: string) => {
    try {
      // Step 1: Ask APEX to generate & store OTP — returns the OTP value
      const res = await fetch(`${APEX_AUTH_BASE}/send-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username }),
      });
      const data = await res.json();

      if (data.status !== 'OK') {
        return { status: data.status, message: data.message || 'Failed to generate OTP.' };
      }

      // Step 2a: Electron — send via nodemailer
      if (window.electronAPI?.isElectron && window.electronAPI.sendOtpEmail) {
        const emailResult = await window.electronAPI.sendOtpEmail(data.email, data.otp);
        if (!emailResult.success) {
          return { status: 'EMAIL_ERROR', message: `OTP generated but email failed: ${emailResult.error}` };
        }
        return { status: 'SENT', message: `OTP sent to ${data.email}. Valid for 15 minutes.` };
      }

      // Step 2b: Browser — send via Brevo HTTP API
      const emailResult = await sendOtpViaBrowser(data.email, data.otp);
      if (!emailResult.success) {
        return { status: 'EMAIL_ERROR', message: `OTP generated but email failed: ${emailResult.error}` };
      }
      return { status: 'SENT', message: `OTP sent to ${data.email}. Valid for 15 minutes.` };

    } catch {
      return { status: 'ERROR', message: 'Unable to connect. Please try again.' };
    }
  }, []);

  const setPassword = useCallback(async (username: string, otp: string, newPassword: string) => {
    try {
      const res = await fetch(`${APEX_AUTH_BASE}/set-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, otp, new_password: newPassword }),
      });
      return await res.json();
    } catch {
      return { status: 'ERROR', message: 'Unable to connect. Please try again.' };
    }
  }, []);

  const uploadPhoto = useCallback(async (username: string, base64: string, mimeType: string) => {
    try {
      const res = await fetch(`${APEX_AUTH_BASE}/upload-photo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, photo: base64, mime_type: mimeType }),
      });
      const data = await res.json();
      if (data.status === 'OK') {
        const photoUrl = `data:${mimeType};base64,${base64}`;
        setUser(prev => {
          if (!prev) return prev;
          const updated = { ...prev, photo: photoUrl };
          localStorage.setItem('erp_user', JSON.stringify(updated));
          return updated;
        });
      }
      return { status: data.status, message: data.message || '' };
    } catch {
      return { status: 'ERROR', message: 'Unable to upload photo.' };
    }
  }, []);

  const changePassword = useCallback(async (username: string, currentPassword: string, newPassword: string) => {
    try {
      const res = await fetch(`${APEX_AUTH_BASE}/change-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, current_password: currentPassword, new_password: newPassword }),
      });
      return await res.json();
    } catch {
      return { status: 'ERROR', message: 'Unable to connect.' };
    }
  }, []);

  const logout = useCallback(() => {
    setUser(null);
    localStorage.removeItem('erp_user');
    localStorage.removeItem('erp_token');
    if (isElectron) {
      (window as any).electronAPI.clearErpSession().catch(() => {});
    }
  }, []);

  return (
    <AuthContext.Provider value={{ user, setUser, isAuthenticated: !!user, login, loginWithStatus, sendOtp, setPassword, uploadPhoto, changePassword, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
};
