import React, { createContext, useContext, useState, useCallback, useRef } from 'react';
import { buildApexUrl } from '../config/api.helper';
import { useAuth } from './AuthContext';
import { getApprovalRequests, emitApprovalsChanged, onApprovalsChanged } from '../services/approvals.service';
import { poExec, PROC } from '../services/po.service';
import type { ApprovalRequest } from '../services/approvals.service';
import dayjs from 'dayjs';

export type NotificationModule = 'General' | 'GL' | 'AP' | 'AR' | 'CM' | 'RM' | 'FA' | 'PMS' | 'Approvals';
export type NotificationStatus = 'Unread' | 'Read' | 'Actioned';

export interface AppNotification {
  id: string;
  module: NotificationModule;
  date: string;
  transaction: string;
  trxNo: string;
  details: string;
  status: NotificationStatus;
  severity?: 'info' | 'warning' | 'error';
  createdAt: number;
  // Approval-specific fields
  approvalRequestId?: number;
  transactionId?: number;
  approvalModule?: string;
  approvalAmount?: number;
  approvalCurrency?: string;
  requestedByName?: string;
  approvalTransactionType?: string;
  approvalDescription?: string;
}

export interface ApprovalApiCall {
  url: string;
  method: string;
  body: Record<string, any>;
  status: number | string;
  response: string;
  ts: number;
}

interface NotificationContextValue {
  notifications: AppNotification[];
  unreadCount: number;
  pendingApprovalCount: number;
  addNotification: (n: Omit<AppNotification, 'id' | 'createdAt'>) => void;
  markRead: (id: string) => void;
  markAllRead: () => void;
  clearAll: () => void;
  checkPdcMaturity: () => Promise<void>;
  refreshPdcNotifications: () => Promise<void>;
  pdcChecking: boolean;
  lastApiUrl: string;
  lastApiResult: string;
  // Approvals
  approvalChecking: boolean;
  checkPendingApprovals: () => Promise<void>;
  refreshApprovalNotifications: () => Promise<void>;
  approveNotification: (requestId: number, notifId: string, meta?: DecisionMeta) => Promise<void>;
  rejectNotification: (requestId: number, notifId: string, comments?: string, meta?: DecisionMeta) => Promise<void>;
  newApprovalRequests: ApprovalRequest[];
  clearNewApprovalRequests: () => void;
  lastApprovalApiCall: ApprovalApiCall | null;
}

/** What is being decided, when the caller knows it (the pop-up toast can act before the bell list has the entry). */
export interface DecisionMeta { module?: string; transactionId?: number; transactionRef?: string }

const NotificationContext = createContext<NotificationContextValue | null>(null);

const uid = () => `notif-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const APEX_PAYMENTS_URL = buildApexUrl('ap/payments');
const APPROVAL_POLL_INTERVAL = 60_000; // 60 seconds

function approvalToNotification(req: ApprovalRequest): AppNotification {
  // a request saved without some details shows what it has ("Request #12"), never "undefined" / "AED NaN"
  const amount = req.amount == null || (req.amount as unknown) === '' ? NaN : Number(req.amount);
  const amt = Number.isFinite(amount)
    ? `${req.currency || ''} ${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`.trim() : '';
  return {
    id: `approval-${req.requestId}`,
    module: 'Approvals',
    date: req.requestedDate,
    transaction: [req.module, req.transactionType].filter(Boolean).join(' ') || 'Approval request',
    trxNo: req.transactionRef || (req.requestId != null ? `Request #${req.requestId}` : ''),
    details: [amt, `submitted by ${req.requestedByName || 'unknown'}`].filter(Boolean).join(' — ')
      + (req.description ? ` · ${req.description}` : ''),
    status: 'Unread',
    severity: 'warning',
    createdAt: Date.now(),
    approvalRequestId: req.requestId,
    transactionId: req.transactionId,
    approvalModule: req.module,
    approvalAmount: req.amount,
    approvalCurrency: req.currency,
    requestedByName: req.requestedByName,
    approvalTransactionType: req.transactionType,
    approvalDescription: req.description,
  };
}

export const NotificationProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  const actorName  = user?.name  ?? user?.username ?? 'Approver';
  const actorEmail = user?.email ?? undefined;

  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [pdcChecking, setPdcChecking] = useState(false);
  const [approvalChecking, setApprovalChecking] = useState(false);
  const [lastApiUrl, setLastApiUrl] = useState('');
  const [lastApiResult, setLastApiResult] = useState('');
  const [newApprovalRequests, setNewApprovalRequests] = useState<ApprovalRequest[]>([]);
  const [lastApprovalApiCall, setLastApprovalApiCall] = useState<ApprovalApiCall | null>(null);

  const isRunningRef = useRef(false);
  const didMountCheck = useRef(false);
  const seenApprovalIdsRef = useRef<Set<number>>(new Set());
  const approvalIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const notificationsRef = useRef<AppNotification[]>([]);
  notificationsRef.current = notifications;

  const addNotification = useCallback((n: Omit<AppNotification, 'id' | 'createdAt'>) => {
    const notif: AppNotification = { ...n, id: uid(), createdAt: Date.now() };
    setNotifications(prev => {
      if (prev.some(x => x.trxNo === notif.trxNo && x.module === notif.module && x.transaction === notif.transaction)) return prev;
      return [notif, ...prev];
    });
  }, []);

  const markRead    = useCallback((id: string) => setNotifications(prev => prev.map(n => n.id === id ? { ...n, status: 'Read' } : n)), []);
  const markAllRead = useCallback(() => setNotifications(prev => prev.map(n => ({ ...n, status: 'Read' }))), []);
  const clearAll    = useCallback(() => setNotifications([]), []);
  const clearNewApprovalRequests = useCallback(() => setNewApprovalRequests([]), []);

  // ── PDC Maturity ─────────────────────────────────────────────────────────────
  const checkPdcMaturity = useCallback(async () => {
    if (isRunningRef.current) return;
    isRunningRef.current = true;
    setPdcChecking(true);
    try {
      const today = dayjs().startOf('day');
      const url = `${APEX_PAYMENTS_URL}?payment_status=Issued&only_pdc=Y&limit=500`;
      setLastApiUrl(url);
      setLastApiResult('Fetching…');

      const res = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!res.ok) {
        const msg = `HTTP ${res.status} ${res.statusText}`;
        setLastApiResult(msg);
        return;
      }

      const data = await res.json();
      const items: any[] = data.items || [];
      const relevant = items.filter(p => !!p.MaturityDate);

      setLastApiResult(
        `Total: ${items.length} | PDC payments: ${relevant.length} | Today: ${today.format('YYYY-MM-DD')}` +
        (relevant.length > 0
          ? `\nMaturity dates: ${relevant.map(p => `${p.PaymentNumber} → ${p.MaturityDate}`).join(', ')}`
          : '')
      );

      relevant.forEach(p => {
        const matDate = dayjs(p.MaturityDate).startOf('day');
        const diffDays = matDate.diff(today, 'day');
        const amt = `AED ${Number(p.PaymentAmount || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
        const payee = p.Payee || 'Unknown';
        let details: string;
        let severity: AppNotification['severity'];
        if (diffDays < 0) {
          details = `PDC overdue by ${Math.abs(diffDays)} day(s) — maturity was ${matDate.format('DD-MMM-YYYY')}. Payee: ${payee}, ${amt}`;
          severity = 'error';
        } else if (diffDays === 0) {
          details = `PDC matures TODAY (${matDate.format('DD-MMM-YYYY')}). Payee: ${payee}, ${amt}`;
          severity = 'warning';
        } else if (diffDays <= 3) {
          details = `PDC matures in ${diffDays} day(s) on ${matDate.format('DD-MMM-YYYY')}. Payee: ${payee}, ${amt}`;
          severity = 'warning';
        } else {
          details = `PDC matures on ${matDate.format('DD-MMM-YYYY')} (${diffDays} days). Payee: ${payee}, ${amt}`;
          severity = 'info';
        }
        addNotification({
          module: 'AP', date: p.MaturityDate, transaction: 'PDC Payment',
          trxNo: String(p.PaymentNumber || p.CheckId || ''),
          details, status: 'Unread', severity,
        });
      });
    } catch (err) {
      const msg = `Error: ${err instanceof Error ? err.message : String(err)}`;
      setLastApiResult(msg);
    } finally {
      isRunningRef.current = false;
      setPdcChecking(false);
    }
  }, [addNotification]);

  const refreshPdcNotifications = useCallback(async () => {
    setNotifications(prev => prev.filter(n => !(n.module === 'AP' && n.transaction === 'PDC Payment')));
    isRunningRef.current = false;
    await checkPdcMaturity();
  }, [checkPdcMaturity]);

  // ── Approval Polling ──────────────────────────────────────────────────────────
  const checkPendingApprovals = useCallback(async () => {
    setApprovalChecking(true);
    try {
      const requests = await getApprovalRequests({ status: 'PENDING' });
      const pendingIds = new Set(requests.map(r => r.requestId));

      // Detect brand-new arrivals (not seen before)
      const fresh = requests.filter(r => !seenApprovalIdsRef.current.has(r.requestId));
      fresh.forEach(r => seenApprovalIdsRef.current.add(r.requestId));
      if (fresh.length > 0) setNewApprovalRequests(fresh);

      setNotifications(prev => {
        // Remove approval notifications that are no longer PENDING
        const kept = prev.filter(n => n.module !== 'Approvals' || (n.approvalRequestId && pendingIds.has(n.approvalRequestId)));
        // Add notifications for any pending requests not already in the list
        const existingIds = new Set(kept.filter(n => n.module === 'Approvals').map(n => n.approvalRequestId));
        const toAdd = requests
          .filter(r => !existingIds.has(r.requestId))
          .map(approvalToNotification);
        return toAdd.length > 0 ? [...toAdd, ...kept] : kept;
      });
    } catch (err) {
      console.error('[Approval Poll]', err);
    } finally {
      setApprovalChecking(false);
    }
  }, []);

  const refreshApprovalNotifications = useCallback(async () => {
    seenApprovalIdsRef.current = new Set();
    setNotifications(prev => prev.filter(n => n.module !== 'Approvals'));
    await checkPendingApprovals();
  }, [checkPendingApprovals]);

  const _doApprovalPut = useCallback(async (
    requestId: number,
    notifId: string,
    status: 'APPROVED' | 'REJECTED',
    comments?: string,
    meta?: DecisionMeta,
  ) => {
    const n = notificationsRef.current.find(x => x.id === notifId || x.approvalRequestId === requestId);
    const module = meta?.module ?? n?.approvalModule;
    const txnId = meta?.transactionId ?? n?.transactionId;
    const ref = meta?.transactionRef ?? n?.trxNo;
    let decidedBy = actorName;

    if (module === 'PROCUREMENT') {
      // Purchasing: through RR_PO_APPROVAL_PKG.DECIDE (po/execute) — refuses your own document and records
      // who decided; the purchase order / requisition follows through the database trigger.
      const poUser = user?.username || user?.email || actorName;
      decidedBy = poUser;
      const url = buildApexUrl('po/execute');
      const params = { p_request_id: requestId, p_decision: status, p_comments: comments || null };
      const body: Record<string, any> = { proc: PROC.decide, params, user: poUser };
      setLastApprovalApiCall({ url, method: 'POST', body, status: 'Pending…', response: '', ts: Date.now() });
      try {
        const r = await poExec(PROC.decide, params, poUser);
        setLastApprovalApiCall({ url, method: 'POST', body, status: 200, response: JSON.stringify(r), ts: Date.now() });
      } catch (err) {
        setLastApprovalApiCall({ url, method: 'POST', body, status: 'Refused', response: String((err as Error)?.message || err), ts: Date.now() });
        throw err;
      }
    } else {
      const url = buildApexUrl(`approvals/requests/${requestId}/status`);
      const body: Record<string, any> = { status, actorName, actorEmail, comments };
      setLastApprovalApiCall({ url, method: 'PUT', body, status: 'Pending…', response: '', ts: Date.now() });
      let rawText = '';
      let httpStatus: number | string = 0;
      try {
        const res = await fetch(url, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        httpStatus = res.status;
        rawText = await res.text().catch(() => res.statusText);
        setLastApprovalApiCall({ url, method: 'PUT', body, status: httpStatus, response: rawText, ts: Date.now() });
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${rawText}`);
      } catch (err) {
        if (httpStatus === 0) {
          setLastApprovalApiCall({ url, method: 'PUT', body, status: 'Network Error', response: String(err), ts: Date.now() });
        }
        throw err;
      }
    }
    setNotifications(prev => prev.map(x => (x.id === notifId || x.approvalRequestId === requestId) ? { ...x, status: 'Actioned' } : x));
    setTimeout(() => setNotifications(prev => prev.filter(x => !(x.id === notifId || x.approvalRequestId === requestId))), 1500);
    // let open screens (invoices, external transactions, purchase orders) show the decision right away
    emitApprovalsChanged({ reason: 'decided', module, transactionId: txnId, transactionRef: ref, status, actorName: decidedBy });
  }, [actorName, actorEmail, user]);

  const approveNotification = useCallback(async (requestId: number, notifId: string, meta?: DecisionMeta) => {
    await _doApprovalPut(requestId, notifId, 'APPROVED', undefined, meta);
  }, [_doApprovalPut]);

  const rejectNotification = useCallback(async (requestId: number, notifId: string, comments?: string, meta?: DecisionMeta) => {
    await _doApprovalPut(requestId, notifId, 'REJECTED', comments, meta);
  }, [_doApprovalPut]);

  // Run on mount: PDC + approvals
  React.useEffect(() => {
    if (didMountCheck.current) return;
    didMountCheck.current = true;
    checkPdcMaturity();
    checkPendingApprovals();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // A request was just sent from this app → show it in the bell now (no wait for the next poll)
  React.useEffect(() => onApprovalsChanged(d => {
    if (d.reason === 'sent') setTimeout(checkPendingApprovals, 400);
  }), [checkPendingApprovals]);

  // Poll approvals every 60 seconds
  React.useEffect(() => {
    approvalIntervalRef.current = setInterval(checkPendingApprovals, APPROVAL_POLL_INTERVAL);
    return () => {
      if (approvalIntervalRef.current) clearInterval(approvalIntervalRef.current);
    };
  }, [checkPendingApprovals]);

  const unreadCount = notifications.filter(n => n.status === 'Unread').length;
  const pendingApprovalCount = notifications.filter(n => n.module === 'Approvals' && n.status !== 'Actioned').length;

  return (
    <NotificationContext.Provider value={{
      notifications, unreadCount, pendingApprovalCount,
      addNotification, markRead, markAllRead, clearAll,
      checkPdcMaturity, refreshPdcNotifications, pdcChecking,
      lastApiUrl, lastApiResult,
      approvalChecking, checkPendingApprovals, refreshApprovalNotifications,
      approveNotification, rejectNotification,
      newApprovalRequests, clearNewApprovalRequests,
      lastApprovalApiCall,
    }}>
      {children}
    </NotificationContext.Provider>
  );
};

export const useNotifications = () => {
  const ctx = useContext(NotificationContext);
  if (!ctx) throw new Error('useNotifications must be used inside NotificationProvider');
  return ctx;
};
