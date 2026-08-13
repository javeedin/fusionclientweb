import React, { useState, useCallback } from 'react';
import { Modal, Form, Input, Button, Space, message, Spin, Alert } from 'antd';
import { EyeOutlined, EyeInvisibleOutlined, CheckCircleOutlined } from '@ant-design/icons';

interface ApiKeySettingsModalProps {
  visible: boolean;
  onClose: () => void;
  apiKey: string;
  onSave: (key: string) => void;
}

const STORAGE_KEY = 'claude_api_key';

export const ApiKeySettingsModal: React.FC<ApiKeySettingsModalProps> = ({
  visible,
  onClose,
  apiKey,
  onSave,
}) => {
  const [form] = Form.useForm();
  const [showKey, setShowKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  const handleSave = useCallback(async () => {
    const values = await form.validateFields();
    onSave(values.apiKey);
    localStorage.setItem(STORAGE_KEY, values.apiKey);
    message.success('API key saved successfully');
    onClose();
  }, [form, onSave, onClose]);

  const handleTestKey = useCallback(async () => {
    const values = await form.validateFields();
    setTesting(true);
    setTestResult(null);
    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': values.apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: 'claude-opus-5',
          max_tokens: 10,
          messages: [{ role: 'user', content: 'test' }],
        }),
      });

      if (response.ok) {
        setTestResult({ success: true, message: 'API key is valid and working!' });
      } else if (response.status === 401 || response.status === 403) {
        setTestResult({ success: false, message: 'Invalid or expired API key. Please check and try again.' });
      } else if (response.status === 400) {
        const data = await response.json().catch(() => ({}));
        const errorMsg = data.error?.message || 'Invalid request parameters';
        setTestResult({ success: false, message: `Request error: ${errorMsg}` });
      } else {
        setTestResult({ success: false, message: `API error: ${response.status} ${response.statusText}` });
      }
    } catch (error) {
      setTestResult({
        success: false,
        message: `Connection error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      });
    } finally {
      setTesting(false);
    }
  }, [form]);

  return (
    <Modal
      title="Claude API Key Settings"
      open={visible}
      onCancel={onClose}
      footer={null}
      width={500}
    >
      <Spin spinning={testing}>
        <Form
          form={form}
          layout="vertical"
          initialValues={{ apiKey: apiKey || localStorage.getItem(STORAGE_KEY) || '' }}
        >
          <Form.Item
            label="Anthropic API Key"
            name="apiKey"
            rules={[{ required: true, message: 'Please enter your API key' }]}
          >
            <Input.Password
              placeholder="sk-ant-..."
              visibilityToggle={{
                visible: showKey,
                onVisibleChange: setShowKey,
              }}
            />
          </Form.Item>

          <div style={{ marginBottom: 16, fontSize: 12, color: '#8c8c8c' }}>
            Get your API key from{' '}
            <a href="https://console.anthropic.com" target="_blank" rel="noopener noreferrer">
              console.anthropic.com
            </a>
          </div>

          {testResult && (
            <Alert
              type={testResult.success ? 'success' : 'error'}
              message={testResult.message}
              icon={testResult.success ? <CheckCircleOutlined /> : undefined}
              style={{ marginBottom: 16 }}
              showIcon
            />
          )}

          <Space style={{ width: '100%' }} direction="vertical">
            <Space style={{ width: '100%', justifyContent: 'flex-end' }}>
              <Button onClick={handleTestKey} loading={testing}>
                Test Key
              </Button>
              <Button type="primary" onClick={handleSave}>
                Save
              </Button>
            </Space>
          </Space>
        </Form>
      </Spin>
    </Modal>
  );
};

export const getSavedApiKey = (): string | null => {
  return localStorage.getItem(STORAGE_KEY);
};

export const savApiKey = (key: string): void => {
  localStorage.setItem(STORAGE_KEY, key);
};
