import React, { createContext, useContext, useState, useCallback } from 'react';
import type { GlValidationLogEntry } from '../services/glValidation.service';

interface GlValidationContextValue {
  sessionErrors:     GlValidationLogEntry[];
  addSessionEntry:   (entry: GlValidationLogEntry) => void;
  clearSession:      () => void;
  drawerOpen:        boolean;
  openDrawer:        () => void;
  closeDrawer:       () => void;
}

const GlValidationContext = createContext<GlValidationContextValue | null>(null);

export const GlValidationProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [sessionErrors, setSessionErrors] = useState<GlValidationLogEntry[]>([]);
  const [drawerOpen,    setDrawerOpen]    = useState(false);

  const addSessionEntry = useCallback((entry: GlValidationLogEntry) => {
    setSessionErrors(prev => [entry, ...prev]);
  }, []);

  const clearSession = useCallback(() => setSessionErrors([]), []);

  return (
    <GlValidationContext.Provider value={{
      sessionErrors,
      addSessionEntry,
      clearSession,
      drawerOpen,
      openDrawer:  () => setDrawerOpen(true),
      closeDrawer: () => setDrawerOpen(false),
    }}>
      {children}
    </GlValidationContext.Provider>
  );
};

export function useGlValidation(): GlValidationContextValue {
  const ctx = useContext(GlValidationContext);
  if (!ctx) throw new Error('useGlValidation must be used inside <GlValidationProvider>');
  return ctx;
}
