import React, { useEffect, useRef } from 'react';
import { notification, Button, Space, Typography } from 'antd';
import { CheckCircleOutlined, StopOutlined, EyeOutlined, BellOutlined } from '@ant-design/icons';
import { useNotifications } from '../context/NotificationContext';
import type { AppNotification } from '../context/NotificationContext';

const { Text } = Typography;

interface Props {
  onOpenPanel: () => void;
}

const ApprovalToastWatcher: React.FC<Props> = ({ onOpenPanel }) => {
  const {
    newApprovalRequests,
    clearNewApprovalRequests,
    approveNotification,
    rejectNotification,
    notifications,
  } = useNotifications();

  const shownRef = useRef<Set<number>>(new Set());

  const getNotifForRequest = (requestId: number): AppNotification | undefined =>
    notifications.find(n => n.approvalRequestId === requestId);

  useEffect(() => {
    if (!newApprovalRequests.length) return;

    const fresh = newApprovalRequests.filter(r => !shownRef.current.has(r.requestId));
    if (!fresh.length) {
      clearNewApprovalRequests();
      return;
    }

    fresh.forEach(req => {
      shownRef.current.add(req.requestId);
      const toastKey = `approval-toast-${req.requestId}`;
      const amt = `${req.currency} ${Number(req.amount).toLocaleString(undefined, { minimumFractionDigits: 2 })}`;

      const handleApprove = async () => {
        const notif = getNotifForRequest(req.requestId);
        if (!notif) return;
        try {
          await approveNotification(req.requestId, notif.id);
          notification.destroy(toastKey);
          notification.success({ message: `Approved: ${req.transactionRef}`, duration: 3 });
        } catch {
          notification.error({ message: 'Approve failed', duration: 4 });
        }
      };

      const handleReject = async () => {
        const notif = getNotifForRequest(req.requestId);
        if (!notif) return;
        try {
          await rejectNotification(req.requestId, notif.id);
          notification.destroy(toastKey);
          notification.warning({ message: `Rejected: ${req.transactionRef}`, duration: 3 });
        } catch {
          notification.error({ message: 'Reject failed', duration: 4 });
        }
      };

      const handleView = () => {
        notification.destroy(toastKey);
        onOpenPanel();
      };

      notification.open({
        key: toastKey,
        message: (
          <Space size={6}>
            <BellOutlined style={{ color: '#D4A800' }} />
            <Text strong style={{ fontSize: 13 }}>Pending Approval</Text>
          </Space>
        ),
        description: (
          <div>
            <div style={{ marginBottom: 6 }}>
              <Text strong style={{ color: '#0572CE' }}>{req.transactionRef}</Text>
              <Text type="secondary" style={{ fontSize: 11, marginLeft: 8 }}>
                {req.module} · {req.transactionType}
              </Text>
            </div>
            <div style={{ marginBottom: 8 }}>
              <Text strong style={{ fontFamily: 'monospace' }}>{amt}</Text>
              <Text type="secondary" style={{ fontSize: 11, marginLeft: 8 }}>
                by {req.requestedByName}
              </Text>
            </div>
            <Space size={6}>
              <Button
                size="small" type="primary" icon={<CheckCircleOutlined />}
                style={{ background: '#1D7B4D', borderColor: '#1D7B4D', fontSize: 12 }}
                onClick={handleApprove}
              >
                Approve
              </Button>
              <Button
                size="small" danger icon={<StopOutlined />}
                style={{ fontSize: 12 }}
                onClick={handleReject}
              >
                Reject
              </Button>
              <Button
                size="small" icon={<EyeOutlined />}
                style={{ fontSize: 12 }}
                onClick={handleView}
              >
                View
              </Button>
            </Space>
          </div>
        ),
        duration: 30,
        placement: 'topRight',
        style: { border: '1px solid #ffe58f', background: '#fffbe6' },
      });
    });

    clearNewApprovalRequests();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newApprovalRequests]);

  return null;
};

export default ApprovalToastWatcher;
