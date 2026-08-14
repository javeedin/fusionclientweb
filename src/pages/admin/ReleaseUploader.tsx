import React, { useState, useEffect } from 'react';
import { Layout, Card, Button, Input, Form, message, Spin, Tag, Space, Divider, Typography, Alert, Upload, Progress } from 'antd';
import { UploadOutlined, CheckCircleOutlined, CloudUploadOutlined } from '@ant-design/icons';
import { Breadcrumb, Row, Col } from 'antd';
import { Link } from 'react-router-dom';
import { HomeOutlined } from '@ant-design/icons';
import { useAuth } from '../../context/AuthContext';

const { Content } = Layout;
const { Title, Text, Paragraph } = Typography;
const { TextArea } = Input;

const REDWOOD = {
  primary: '#C74634',
  primaryLight: '#E85D4A',
  primaryDark: '#A33B2C',
  success: '#1D7B4D',
  warning: '#D4A800',
  info: '#0572CE',
  neutral100: '#F7F7F7',
  neutral200: '#E5E5E5',
  neutral300: '#C7C7C7',
  neutral600: '#6B6B6B',
  neutral900: '#1A1A1A',
  surface: '#FFFFFF',
};

const ReleaseUploader: React.FC = () => {
  const { user } = useAuth();
  const [form] = Form.useForm();
  const [currentVersion, setCurrentVersion] = useState<string>('');
  const [newVersion, setNewVersion] = useState<string>('');
  const [releaseNotes, setReleaseNotes] = useState<string>('');
  const [exeFile, setExeFile] = useState<File | null>(null);
  const [githubToken, setGithubToken] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [showTokenInput, setShowTokenInput] = useState(false);

  // Load current version from package.json
  useEffect(() => {
    const loadCurrentVersion = async () => {
      try {
        const response = await fetch('/package.json');
        const pkg = await response.json();
        setCurrentVersion(pkg.version);
      } catch (err) {
        message.error('Failed to load current version');
        console.error(err);
      }
    };
    loadCurrentVersion();
  }, []);

  const validateVersion = (version: string) => {
    const semverRegex = /^\d+\.\d+\.\d+$/;
    return semverRegex.test(version);
  };

  const isVersionNewer = (newVer: string, currentVer: string) => {
    const newParts = newVer.split('.').map(Number);
    const currentParts = currentVer.split('.').map(Number);

    for (let i = 0; i < 3; i++) {
      if (newParts[i] > currentParts[i]) return true;
      if (newParts[i] < currentParts[i]) return false;
    }
    return false;
  };

  const handleUpload = async () => {
    // Validation
    if (!newVersion) {
      message.error('Please enter a new version number');
      return;
    }

    if (!validateVersion(newVersion)) {
      message.error('Version must be in format: X.Y.Z (e.g., 1.0.1)');
      return;
    }

    if (!isVersionNewer(newVersion, currentVersion)) {
      message.error(`New version (${newVersion}) must be higher than current (${currentVersion})`);
      return;
    }

    if (!exeFile) {
      message.error('Please select an exe file to upload');
      return;
    }

    if (!githubToken) {
      message.error('GitHub token is required');
      return;
    }

    if (exeFile.type !== 'application/octet-stream' && !exeFile.name.endsWith('.exe')) {
      message.error('Please select a valid .exe file');
      return;
    }

    setUploading(true);
    setUploadProgress(0);

    try {
      // Step 1: Create release
      console.log('[Release] Creating GitHub release v' + newVersion);
      setUploadProgress(20);

      const createReleaseResponse = await fetch(
        'https://api.github.com/repos/javeedin/fusionclientweb/releases',
        {
          method: 'POST',
          headers: {
            'Authorization': `token ${githubToken}`,
            'Content-Type': 'application/json',
            'Accept': 'application/vnd.github.v3+json',
          },
          body: JSON.stringify({
            tag_name: `${user?.company}-v${newVersion}`,
            name: `${user?.company} - Version ${newVersion}`,
            body: `**Company:** ${user?.company}\n\n${releaseNotes || 'Update release'}`,
            draft: false,
            prerelease: false,
          }),
        }
      );

      if (!createReleaseResponse.ok) {
        const error = await createReleaseResponse.json();
        throw new Error(error.message || 'Failed to create release');
      }

      const release = await createReleaseResponse.json();
      const uploadUrl = release.upload_url.replace('{?name,label}', '');

      console.log('[Release] Release created:', release.id);
      setUploadProgress(40);

      // Step 2: Upload exe asset with company name prefix
      console.log('[Release] Uploading exe asset...');
      const assetFileName = `${user?.company}-${exeFile.name}`;
      const uploadAssetResponse = await fetch(
        `${uploadUrl}?name=${assetFileName}`,
        {
          method: 'POST',
          headers: {
            'Authorization': `token ${githubToken}`,
            'Content-Type': 'application/octet-stream',
            'Accept': 'application/vnd.github.v3+json',
          },
          body: exeFile,
        }
      );

      if (!uploadAssetResponse.ok) {
        const error = await uploadAssetResponse.json();
        throw new Error(error.message || 'Failed to upload asset');
      }

      setUploadProgress(100);
      message.success(`Release v${newVersion} created and uploaded successfully!`);

      // Reset form
      form.resetFields();
      setExeFile(null);
      setNewVersion('');
      setReleaseNotes('');
      setGithubToken('');
      setShowTokenInput(false);

    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Unknown error';
      message.error(`Upload failed: ${errMsg}`);
      console.error('[Release] Error:', err);
    } finally {
      setUploading(false);
      setUploadProgress(0);
    }
  };

  return (
    <Layout style={{ minHeight: 'calc(100vh - 64px)', background: REDWOOD.neutral100 }}>
      <Content>
        {/* Breadcrumb Header */}
        <div style={{
          padding: '16px 24px',
          background: REDWOOD.surface,
          borderBottom: `1px solid ${REDWOOD.neutral200}`,
        }}>
          <Breadcrumb
            items={[
              { title: <Link to="/home"><HomeOutlined /> Home</Link> },
              { title: <Link to="/admin">Administration</Link> },
              { title: 'Release Uploader' },
            ]}
          />
        </div>

        {/* Main Content */}
        <div style={{ padding: 24 }}>
          <div style={{ marginBottom: 32 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <div style={{
                width: 56,
                height: 56,
                borderRadius: 12,
                background: `linear-gradient(135deg, ${REDWOOD.primary} 0%, ${REDWOOD.primaryDark} 100%)`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: `0 4px 12px ${REDWOOD.primary}40`,
              }}>
                <CloudUploadOutlined style={{ fontSize: 28, color: '#fff' }} />
              </div>
              <div>
                <Title level={2} style={{ margin: 0, color: REDWOOD.neutral900 }}>
                  Release Uploader
                </Title>
                <Text type="secondary">
                  Create and upload new versions to GitHub Releases
                </Text>
                <div style={{ marginTop: 8 }}>
                  <Text strong>Company: </Text>
                  <Tag color="blue">{user?.company || 'Unknown'}</Tag>
                </div>
              </div>
            </div>
          </div>

          <Row gutter={24}>
            <Col xs={24} md={14}>
              <Card
                title="Upload New Release"
                bordered={false}
                style={{ boxShadow: '0 2px 8px rgba(0,0,0,0.1)' }}
              >
                <Alert
                  message="Current Version"
                  description={currentVersion || 'Loading...'}
                  type="info"
                  showIcon
                  style={{ marginBottom: 24 }}
                />

                <Form form={form} layout="vertical" onFinish={handleUpload}>
                  <Form.Item label="New Version Number">
                    <Input
                      placeholder="e.g., 1.0.1"
                      value={newVersion}
                      onChange={(e) => setNewVersion(e.target.value)}
                      disabled={uploading}
                      prefix="v"
                    />
                    <Text type="secondary" style={{ fontSize: 12, marginTop: 4, display: 'block' }}>
                      Format: X.Y.Z (must be higher than {currentVersion})
                    </Text>
                  </Form.Item>

                  <Form.Item label="Release Notes">
                    <TextArea
                      placeholder="Describe the changes in this release..."
                      rows={4}
                      value={releaseNotes}
                      onChange={(e) => setReleaseNotes(e.target.value)}
                      disabled={uploading}
                    />
                  </Form.Item>

                  <Form.Item label="Executable File (.exe)">
                    <Upload
                      accept=".exe"
                      maxCount={1}
                      beforeUpload={(file) => {
                        setExeFile(file);
                        return false;
                      }}
                      disabled={uploading}
                    >
                      <Button icon={<UploadOutlined />} disabled={uploading}>
                        {exeFile ? `Selected: ${exeFile.name}` : 'Select .exe file'}
                      </Button>
                    </Upload>
                    {exeFile && (
                      <Text type="success" style={{ fontSize: 12, marginTop: 4, display: 'block' }}>
                        ✓ {exeFile.name} ({(exeFile.size / 1024 / 1024).toFixed(2)} MB)
                      </Text>
                    )}
                  </Form.Item>

                  <Divider />

                  <Form.Item label="GitHub Personal Access Token">
                    <Input.Password
                      placeholder="ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                      value={githubToken}
                      onChange={(e) => setGithubToken(e.target.value)}
                      disabled={uploading}
                    />
                    <Text type="secondary" style={{ fontSize: 12, marginTop: 4, display: 'block' }}>
                      Requires 'repo' permissions.{' '}
                      <a href="https://github.com/settings/tokens" target="_blank" rel="noopener noreferrer">
                        Create token →
                      </a>
                    </Text>
                  </Form.Item>

                  {uploading && (
                    <div style={{ marginBottom: 16 }}>
                      <Progress percent={uploadProgress} status={uploadProgress === 100 ? 'success' : 'active'} />
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        {uploadProgress === 20 && 'Creating release...'}
                        {uploadProgress === 40 && 'Uploading exe file...'}
                        {uploadProgress === 100 && 'Upload complete!'}
                      </Text>
                    </div>
                  )}

                  <Space style={{ width: '100%', justifyContent: 'flex-end' }}>
                    <Button disabled={uploading}>Cancel</Button>
                    <Button
                      type="primary"
                      icon={<CloudUploadOutlined />}
                      onClick={handleUpload}
                      loading={uploading}
                      disabled={!newVersion || !exeFile || !githubToken}
                    >
                      {uploading ? 'Uploading...' : 'Upload Release'}
                    </Button>
                  </Space>
                </Form>
              </Card>
            </Col>

            <Col xs={24} md={10}>
              <Card
                title="Quick Actions"
                bordered={false}
                style={{ boxShadow: '0 2px 8px rgba(0,0,0,0.1)', marginBottom: 24 }}
              >
                <Space direction="vertical" style={{ width: '100%' }}>
                  <Button
                    type="default"
                    block
                    onClick={() => {
                      window.open('https://github.com/javeedin/fusionclientweb/releases', '_blank');
                    }}
                  >
                    View Releases on GitHub
                  </Button>
                  <Button
                    type="default"
                    block
                    onClick={() => {
                      window.open('https://github.com/settings/tokens/new?scopes=repo', '_blank');
                    }}
                  >
                    Create GitHub Token
                  </Button>
                </Space>
              </Card>

              <Card
                title="Version Info"
                bordered={false}
                style={{ boxShadow: '0 2px 8px rgba(0,0,0,0.1)' }}
              >
                <Paragraph>
                  <Text strong>Current Version:</Text>
                  <Tag color="blue" style={{ marginLeft: 8 }}>
                    {currentVersion || 'Loading...'}
                  </Tag>
                </Paragraph>

                <Divider style={{ margin: '12px 0' }} />

                <Paragraph style={{ fontSize: 12, color: REDWOOD.neutral600 }}>
                  <strong>How it works:</strong>
                  <ol style={{ marginTop: 8, paddingLeft: 20 }}>
                    <li>Build your app and create a new .exe file</li>
                    <li>Enter new version (must be higher than current)</li>
                    <li>Upload the .exe and release notes</li>
                    <li>Users will see "Update Available" in Check for Updates</li>
                  </ol>
                </Paragraph>
              </Card>
            </Col>
          </Row>
        </div>
      </Content>
    </Layout>
  );
};

export default ReleaseUploader;
