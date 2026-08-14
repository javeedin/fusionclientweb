import React from 'react';
import { Modal, Button, Space, Typography, Progress, Alert, Spin, Divider } from 'antd';
import { DownloadOutlined, CheckCircleOutlined } from '@ant-design/icons';
import { useUpdateChecker } from '../hooks/useUpdateChecker';

const { Text, Paragraph } = Typography;

interface UpdateCheckerProps {
  open: boolean;
  onClose: () => void;
}

export const UpdateChecker: React.FC<UpdateCheckerProps> = ({ open, onClose }) => {
  const { updateInfo, loading, installing, error, checkForUpdates, downloadAndInstall } = useUpdateChecker();

  React.useEffect(() => {
    if (open && !updateInfo && !loading) {
      checkForUpdates();
    }
  }, [open, updateInfo, loading, checkForUpdates]);

  const handleRetry = () => {
    checkForUpdates();
  };

  const handleDownloadAndInstall = () => {
    if (updateInfo?.hasUpdate && updateInfo.downloadUrl && updateInfo.downloadName) {
      downloadAndInstall(updateInfo.downloadUrl, updateInfo.downloadName);
    }
  };

  return (
    <Modal
      title="Check for Updates"
      open={open}
      onCancel={onClose}
      width={500}
      footer={null}
      destroyOnClose
    >
      {loading && (
        <div style={{ textAlign: 'center', padding: '32px 0' }}>
          <Spin tip="Checking for updates..." />
        </div>
      )}

      {!loading && error && (
        <div>
          <Alert
            message="Error Checking Updates"
            description={error}
            type="error"
            showIcon
            style={{ marginBottom: 16 }}
          />
          <Button type="primary" block onClick={handleRetry}>
            Retry
          </Button>
        </div>
      )}

      {!loading && !error && updateInfo && (
        <div>
          <div style={{ marginBottom: 16 }}>
            <Text strong style={{ fontSize: 14 }}>Current Version:</Text>
            <Text style={{ fontSize: 14, marginLeft: 12 }}>{updateInfo.currentVersion}</Text>
          </div>

          {updateInfo.hasUpdate && (
            <>
              <Alert
                message="Update Available"
                description={`New version ${updateInfo.latestVersion} is available!`}
                type="success"
                showIcon
                icon={<CheckCircleOutlined />}
                style={{ marginBottom: 16 }}
              />

              <div style={{ marginBottom: 16 }}>
                <Text strong style={{ fontSize: 14 }}>Latest Version:</Text>
                <Text style={{ fontSize: 14, marginLeft: 12, color: '#1677ff' }}>
                  {updateInfo.latestVersion}
                </Text>
              </div>

              {updateInfo.releaseNotes && (
                <>
                  <Divider style={{ margin: '12px 0' }} />
                  <div style={{ marginBottom: 16 }}>
                    <Text strong style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>
                      Release Notes:
                    </Text>
                    <div
                      style={{
                        fontSize: 12,
                        color: '#666',
                        maxHeight: 200,
                        overflow: 'auto',
                        padding: '8px 12px',
                        background: '#f5f5f5',
                        borderRadius: 4,
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-word',
                      }}
                    >
                      {updateInfo.releaseNotes}
                    </div>
                  </div>
                </>
              )}

              {installing && (
                <div style={{ marginBottom: 16 }}>
                  <Progress
                    type="circle"
                    percent={100}
                    status="active"
                    width={48}
                    format={() => <DownloadOutlined />}
                  />
                  <Text style={{ fontSize: 12, marginLeft: 12, color: '#666' }}>
                    Downloading and installing update...
                  </Text>
                </div>
              )}

              <Space style={{ width: '100%', justifyContent: 'flex-end' }}>
                <Button onClick={onClose} disabled={installing}>
                  Cancel
                </Button>
                <Button
                  type="primary"
                  icon={<DownloadOutlined />}
                  onClick={handleDownloadAndInstall}
                  loading={installing}
                  disabled={installing}
                >
                  {installing ? 'Installing...' : 'Download & Install'}
                </Button>
              </Space>
            </>
          )}

          {!updateInfo.hasUpdate && (
            <>
              <Alert
                message="Up to Date"
                description={updateInfo.message || 'You are running the latest version'}
                type="success"
                showIcon
                icon={<CheckCircleOutlined />}
                style={{ marginBottom: 16 }}
              />
              <Button type="primary" block onClick={onClose}>
                Close
              </Button>
            </>
          )}
        </div>
      )}
    </Modal>
  );
};
