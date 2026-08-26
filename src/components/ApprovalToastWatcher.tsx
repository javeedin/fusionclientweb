import React, { useEffect, useRef, useState } from 'react';
import { notification, Button, Space, Typography, Modal, Card, Tag, Descriptions, Divider } from 'antd';
import { CheckCircleOutlined, StopOutlined, EyeOutlined, BellOutlined, ApiOutlined } from '@ant-design/icons';
import { useNotifications } from '../context/NotificationContext';
import type { AppNotification } from '../context/NotificationContext';
import { buildApexUrl } from '../config/api.helper';

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

  const [apiInspectorVisible, setApiInspectorVisible] = useState(false);
  const [selectedRequest, setSelectedRequest] = useState<any>(null);
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

      // The notification id is only used to mark the panel entry "Actioned" —
      // never let a missing/stale match block the actual PUT (that silently
      // swallowed clicks when the polled list had rebuilt under the toast).
      const handleApprove = async () => {
        const notif = getNotifForRequest(req.requestId);
        try {
          await approveNotification(req.requestId, notif?.id ?? `approval-${req.requestId}`);
          notification.destroy(toastKey);
          notification.success({ message: `Approved: ${req.transactionRef}`, duration: 3 });
        } catch (err: any) {
          notification.error({ message: 'Approve failed', description: err?.message, duration: 5 });
        }
      };

      const handleReject = async () => {
        const notif = getNotifForRequest(req.requestId);
        try {
          await rejectNotification(req.requestId, notif?.id ?? `approval-${req.requestId}`);
          notification.destroy(toastKey);
          notification.warning({ message: `Rejected: ${req.transactionRef}`, duration: 3 });
        } catch (err: any) {
          notification.error({ message: 'Reject failed', description: err?.message, duration: 5 });
        }
      };

      const handleView = () => {
        notification.destroy(toastKey);
        onOpenPanel();
      };

      const handleShowApi = () => {
        notification.destroy(toastKey);
        setSelectedRequest(req);
        setApiInspectorVisible(true);
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
                size="small" icon={<ApiOutlined />}
                style={{ fontSize: 12, color: '#0572CE', borderColor: '#0572CE' }}
                onClick={handleShowApi}
              >
                API
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

  const getApprovalApiDetails = (req: any) => {
    const requestId = req.requestId;
    const endpoint = `approvals/requests/${requestId}/status`;
    const fullUrl = buildApexUrl(endpoint);
    const method = 'PUT';
    const body = {
      status: 'APPROVED', // or 'REJECTED'
      actorName: 'Current User Name',
      actorEmail: 'current.user@email.com',
      comments: ''
    };

    return { fullUrl, endpoint, method, body };
  };

  if (!selectedRequest) return null;

  const apiDetails = getApprovalApiDetails(selectedRequest);

  return (
    <>
      <Modal
        title={`API Inspector — Approval Action`}
        open={apiInspectorVisible}
        onCancel={() => setApiInspectorVisible(false)}
        width={900}
        footer={null}
      >
        <div style={{ maxHeight: '600px', overflowY: 'auto' }}>
          <Space direction="vertical" style={{ width: '100%' }} size="large">
            {/* Transaction Info */}
            <Card size="small" style={{ background: '#f5f5f5' }}>
              <Descriptions column={1} size="small">
                <Descriptions.Item label="Transaction Ref">
                  <Text strong style={{ color: '#0572CE' }}>{selectedRequest.transactionRef}</Text>
                </Descriptions.Item>
                <Descriptions.Item label="Module">
                  <Tag>{selectedRequest.module}</Tag>
                </Descriptions.Item>
                <Descriptions.Item label="Type">
                  <Tag>{selectedRequest.transactionType}</Tag>
                </Descriptions.Item>
                <Descriptions.Item label="Amount">
                  <Text strong style={{ fontFamily: 'monospace' }}>
                    {selectedRequest.currency} {Number(selectedRequest.amount).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </Text>
                </Descriptions.Item>
              </Descriptions>
            </Card>

            <Divider style={{ margin: '8px 0' }} />

            {/* API Endpoint */}
            <div>
              <Text strong style={{ fontSize: 12, color: '#666', display: 'block', marginBottom: 8 }}>API ENDPOINT (FULL URL)</Text>
              <Card size="small" style={{ background: '#e6f7ff', borderColor: '#1890ff' }}>
                <div style={{ fontFamily: 'monospace', fontSize: 11, wordBreak: 'break-all', color: '#0572CE' }}>
                  <Tag color="blue">PUT</Tag>
                  {' '}{apiDetails.fullUrl}
                </div>
              </Card>
            </div>

            {/* Request Body */}
            <div>
              <Text strong style={{ fontSize: 12, color: '#666', display: 'block', marginBottom: 8 }}>REQUEST BODY (JSON)</Text>
              <Card size="small" style={{ background: '#f5f5f5' }}>
                <pre style={{
                  margin: 0,
                  fontSize: 11,
                  maxHeight: 250,
                  overflowY: 'auto',
                  wordBreak: 'break-all',
                  whiteSpace: 'pre-wrap',
                  padding: '8px',
                  background: '#fff',
                  borderRadius: 4
                }}>
                  {JSON.stringify(
                    {
                      status: 'APPROVED',
                      actorName: 'Current User Name',
                      actorEmail: 'current.user@email.com',
                      comments: ''
                    },
                    null,
                    2
                  )}
                </pre>
              </Card>
            </div>

            {/* Headers */}
            <div>
              <Text strong style={{ fontSize: 12, color: '#666', display: 'block', marginBottom: 8 }}>REQUEST HEADERS</Text>
              <Card size="small" style={{ background: '#f5f5f5' }}>
                <pre style={{
                  margin: 0,
                  fontSize: 11,
                  padding: '8px',
                  background: '#fff',
                  borderRadius: 4
                }}>
                  Content-Type: application/json
                </pre>
              </Card>
            </div>

            {/* Response */}
            <div>
              <Text strong style={{ fontSize: 12, color: '#666', display: 'block', marginBottom: 8 }}>SUCCESS RESPONSE</Text>
              <Card size="small" style={{ background: '#f5f5f5' }}>
                <pre style={{
                  margin: 0,
                  fontSize: 11,
                  padding: '8px',
                  background: '#fff',
                  borderRadius: 4
                }}>
                  HTTP/1.1 200 OK
                </pre>
              </Card>
            </div>
          </Space>
        </div>
      </Modal>
    </>
  );
};

export default ApprovalToastWatcher;
