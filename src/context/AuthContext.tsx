import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import type { User, AuthContextType, LoginResult } from '../types';
import { getCurrentCompany } from '../config/company.config';
import { fusionSOAPLogin } from '../services/fusion-soap-login.service';
import { buildApexUrl, buildApexAuthUrl, buildApexAdminUrl } from '../config/api.helper';


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
      const currentCompany = getCurrentCompany();
      const fusionInstances = currentCompany.fusionInstances || [];

      console.log('[Auth] Logging in with company:', currentCompany.code);
      console.log('[Auth] Fusion instances available:', fusionInstances.length);

      // Decision: based on company configuration
      if (fusionInstances.length > 0) {
        console.log('[Auth] Company configured for Fusion login - Attempting Fusion SOAP login...');

        // Get the selected instance from sessionStorage (set by Login component)
        const selectedInstanceUrl = sessionStorage.getItem('fusionInstanceUrl');
        if (!selectedInstanceUrl) {
          console.error('[Auth] No Fusion instance URL found in sessionStorage');
          return { status: 'ERROR', message: 'Fusion instance not selected. Please select an instance and try again.' };
        }

        const fusionResult = await fusionSOAPLogin(selectedInstanceUrl, username, password);
        if (fusionResult.success && fusionResult.sessionId) {
          console.log('[Auth] Fusion login SUCCESS - Session ID obtained');
          const uname = username;
          const userData: User = {
            id: uname,
            username: uname,
            name: username,
            email: username,
            role: 'User',
            company: currentCompany.code,
          };

          setUser(userData);
          localStorage.setItem('erp_user', JSON.stringify(userData));
          localStorage.setItem('erp_token', fusionResult.sessionId);
          localStorage.setItem('fusion_session_id', fusionResult.sessionId);
          // Store username and password for Basic Auth on REST API calls
          localStorage.setItem('fusion_username', username);
          sessionStorage.setItem('fusion_password', password);
          if (isElectron) {
            (window as any).electronAPI.saveErpSession(userData, fusionResult.sessionId).catch(() => {});
          }

          return { status: 'SUCCESS', message: 'Logged in via Oracle Fusion' };
        } else {
          console.error('[Auth] Fusion login failed:', fusionResult.error);
          return { status: 'ERROR', message: fusionResult.error || 'Fusion login failed' };
        }
      } else {
        // Company has NO Fusion instances - use APEX login
        console.log('[Auth] Company configured for APEX login - Using APEX authentication (direct URL)');
        const loginUrl = buildApexAuthUrl('login');
        const res = await fetch(loginUrl, {
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
            company: currentCompany.code,
          };
          // Load profile photo
          try {
            const photoUrl = buildApexAuthUrl(`profile-photo/${encodeURIComponent(uname)}`);
            const photoRes = await fetch(photoUrl);
            const photoData = await photoRes.json();
            if (photoData.status === 'OK' && photoData.photo) {
              userData.photo = `data:${photoData.mime_type};base64,${photoData.photo}`;
            }
          } catch { /* photo is optional */ }

          // Load user access (isAdmin, modules, bus)
          try {
            const accessUrl = buildApexAdminUrl(`user-access/${encodeURIComponent(uname)}`);
            const accessRes = await fetch(accessUrl);
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
          localStorage.removeItem('fusion_session_id');
          if (isElectron) {
            (window as any).electronAPI.saveErpSession(userData, data.token || '').catch(() => {});
          }
        }

        return { status: data.status, message: data.message || '' };
      }
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
      const otpUrl = buildApexAuthUrl('send-otp');
      const res = await fetch(otpUrl, {
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
      const pwdUrl = buildApexAuthUrl('set-password');
      const res = await fetch(pwdUrl, {
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
      const currentCompany = getCurrentCompany();
      const APEX_AUTH_BASE = `${currentCompany.apexBaseUrl}/auth`;

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
      const currentCompany = getCurrentCompany();
      const APEX_AUTH_BASE = `${currentCompany.apexBaseUrl}/auth`;

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
    localStorage.removeItem('fusion_session_id');
    localStorage.removeItem('fusion_username');
    sessionStorage.removeItem('fusion_password');
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
