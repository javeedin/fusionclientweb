import React, { useState, useEffect } from 'react';
import { Layout, Dropdown, Avatar, Space, Typography, Tooltip, Badge, Button, Modal, Tag } from 'antd';
import {
  UserOutlined,
  LogoutOutlined,
  SettingOutlined,
  HomeOutlined,
  CloudServerOutlined,
  CloudOutlined,
  StarOutlined,
  FlagOutlined,
  EyeOutlined,
  BellOutlined,
  DownloadOutlined,
  ShareAltOutlined,
  PlusSquareOutlined,
  ProfileOutlined,
  PlaySquareOutlined,
  GlobalOutlined,
  BookOutlined,
  WarningOutlined,
  RobotOutlined,
} from '@ant-design/icons';
import { Outlet, useNavigate, Link } from 'react-router-dom';
import { ShowAndTellPanel } from '../features/showAndTell';
import { useAuth } from '../context/AuthContext';
import { useGlValidation } from '../context/GlValidationContext';
import { useNotifications } from '../context/NotificationContext';
import ProfileModal from '../components/ProfileModal';
import SupportTicketButton from '../components/SupportTicketButton';
import ScreenRecorder from '../components/ScreenRecorder';
import GlValidationErrorsDrawer from '../components/GlValidationErrorsDrawer';
import GlobalMenuSearch from '../components/GlobalMenuSearch';
import NotificationPanel from '../components/NotificationPanel';
import ApprovalToastWatcher from '../components/ApprovalToastWatcher';
import Autopilot from '../components/Autopilot';
import type { MenuProps } from 'antd';

// Type for BeforeInstallPromptEvent
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

// Detect iOS device
const isIOS = () => {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
};

// Detect if in standalone mode (already installed)
const isInStandaloneMode = () => {
  return window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as any).standalone === true;
};

const { Content } = Layout;
const { Text } = Typography;

// Oracle Redwood Color
const REDWOOD_PRIMARY = '#C74634';

const MainLayout: React.FC = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const { sessionErrors, openDrawer: openValidationDrawer } = useGlValidation();
  const failedCount = sessionErrors.filter(e => e.result === 'FAILED').length;
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [showIOSModal, setShowIOSModal] = useState(false);

  // Signed-in Oracle Fusion user (captured by the Fusion Client login). Reads
  // sessionStorage and stays in sync via the 'fusion-user-changed' event.
  const [fusionUser, setFusionUser] = useState<string | null>(() => sessionStorage.getItem('fusion_user'));
  useEffect(() => {
    const sync = () => setFusionUser(sessionStorage.getItem('fusion_user'));
    window.addEventListener('fusion-user-changed', sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener('fusion-user-changed', sync);
      window.removeEventListener('storage', sync);
    };
  }, []);
  const [showInstallButton, setShowInstallButton] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [showAndTellOpen, setShowAndTellOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [autopilotOpen, setAutopilotOpen] = useState(false);
  const { unreadCount } = useNotifications();

  // Listen for PWA install prompt
  useEffect(() => {
    // Check if already installed
    if (isInStandaloneMode()) {
      setIsInstalled(true);
      return;
    }

    // Show install button for iOS (manual instructions needed)
    if (isIOS()) {
      setShowInstallButton(true);
      return;
    }

    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setInstallPrompt(e as BeforeInstallPromptEvent);
      setShowInstallButton(true);
    };

    const handleAppInstalled = () => {
      setIsInstalled(true);
      setInstallPrompt(null);
      setShowInstallButton(false);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  const handleInstallClick = async () => {
    // iOS - show instructions modal
    if (isIOS()) {
      setShowIOSModal(true);
      return;
    }

    // Android/Desktop - use native prompt
    if (!installPrompt) return;

    await installPrompt.prompt();
    const { outcome } = await installPrompt.userChoice;

    if (outcome === 'accepted') {
      setInstallPrompt(null);
      setShowInstallButton(false);
    }
  };

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const userMenuItems: MenuProps['items'] = [
    {
      key: 'profile',
      icon: <UserOutlined />,
      label: 'My Profile',
      onClick: () => setShowProfile(true),
    },
    {
      key: 'settings',
      icon: <SettingOutlined />,
      label: 'Settings',
    },
    {
      type: 'divider',
    },
    {
      key: 'logout',
      icon: <LogoutOutlined />,
      label: 'Sign Out',
      onClick: handleLogout,
    },
  ];

  return (
    <Layout style={{ minHeight: '100vh' }}>
      {/* Global Toolbar - Oracle Fusion Style */}
      <div style={{
        padding: '8px 24px',
        background: REDWOOD_PRIMARY,
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}>
        {/* Left side - Logo and App Name */}
        <Link to="/home" style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none' }}>
          {/* Re-ERP logo mark */}
          <svg width="36" height="36" viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect width="36" height="36" rx="7" fill="rgba(255,255,255,0.18)"/>
            <rect x="4"  y="4"  width="12" height="12" rx="2.5" fill="rgba(255,255,255,0.92)"/>
            <rect x="20" y="4"  width="12" height="12" rx="2.5" fill="rgba(255,255,255,0.65)"/>
            <rect x="4"  y="20" width="12" height="12" rx="2.5" fill="rgba(255,255,255,0.65)"/>
            <rect x="20" y="20" width="12" height="12" rx="2.5" fill="rgba(255,255,255,0.38)"/>
            <rect x="16" y="9"  width="4"  height="2"  rx="1" fill="rgba(255,255,255,0.6)"/>
            <rect x="16" y="25" width="4"  height="2"  rx="1" fill="rgba(255,255,255,0.4)"/>
            <rect x="9"  y="16" width="2"  height="4"  rx="1" fill="rgba(255,255,255,0.6)"/>
            <rect x="25" y="16" width="2"  height="4"  rx="1" fill="rgba(255,255,255,0.4)"/>
            <text x="5.5" y="13.5" fontFamily="Arial Black, Arial, sans-serif" fontSize="8" fontWeight="900" fill="#C74634">Re</text>
          </svg>
          <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.1 }}>
            <Text strong style={{ color: '#fff', fontSize: 17, letterSpacing: 0.5 }}>
              Re-<span style={{ fontWeight: 400 }}>ERP</span>
            </Text>
            <Text style={{ color: 'rgba(255,255,255,0.6)', fontSize: 10, letterSpacing: 1 }}>
              ENTERPRISE PLATFORM
            </Text>
          </div>
        </Link>

        {/* Right side - Icons */}
        <Space size={4}>
          {/* Install App Button - shows on iOS, Android, and Desktop when installable */}
          {showInstallButton && !isInstalled && (
            <Tooltip title="Install App">
              <Button
                type="text"
                icon={<DownloadOutlined style={{ fontSize: 18, color: '#fff' }} />}
                style={{
                  color: '#fff',
                  background: 'rgba(255,255,255,0.15)',
                  borderRadius: 4,
                }}
                onClick={handleInstallClick}
              />
            </Tooltip>
          )}
          {/* Global Menu Search */}
          <GlobalMenuSearch />
          <Tooltip title="Home">
            <Button
              type="text"
              icon={<HomeOutlined style={{ fontSize: 18, color: '#fff' }} />}
              style={{ color: '#fff' }}
              onClick={() => navigate('/home')}
            />
          </Tooltip>
          <Tooltip title="Favorites">
            <Button
              type="text"
              icon={<StarOutlined style={{ fontSize: 18, color: '#fff' }} />}
              style={{ color: '#fff' }}
            />
          </Tooltip>
          <Tooltip title="Recent Items">
            <Button
              type="text"
              icon={<FlagOutlined style={{ fontSize: 18, color: '#fff' }} />}
              style={{ color: '#fff' }}
            />
          </Tooltip>
          <Tooltip title="Watchlist">
            <Button
              type="text"
              icon={<EyeOutlined style={{ fontSize: 18, color: '#fff' }} />}
              style={{ color: '#fff' }}
            />
          </Tooltip>
          <Tooltip title="Notifications">
            <Badge count={unreadCount} size="small" offset={[-5, 5]} overflowCount={99}>
              <Button
                type="text"
                icon={<BellOutlined style={{ fontSize: 18, color: '#fff' }} />}
                style={{ color: '#fff', background: notifOpen ? 'rgba(255,255,255,0.2)' : undefined }}
                onClick={() => setNotifOpen(true)}
              />
            </Badge>
          </Tooltip>
          <Tooltip title="My Tickets" placement="bottom">
            <Button
              type="text"
              icon={<ProfileOutlined style={{ fontSize: 16, color: '#fff' }} />}
              onClick={() => navigate('/support/my-tickets')}
              style={{ color: '#fff' }}
            />
          </Tooltip>
          <ScreenRecorder />
          <Tooltip title="Training Library" placement="bottom">
            <Button
              type="text"
              icon={<PlaySquareOutlined style={{ fontSize: 18, color: '#fff' }} />}
              style={{ color: '#fff' }}
              onClick={() => navigate('/training')}
            />
          </Tooltip>
          <Tooltip title="Show &amp; Tell" placement="bottom">
            <Button
              type="text"
              icon={<BookOutlined style={{ fontSize: 18, color: '#fff' }} />}
              style={{ color: '#fff', background: showAndTellOpen ? 'rgba(255,255,255,0.2)' : undefined }}
              onClick={() => setShowAndTellOpen(true)}
            />
          </Tooltip>
          <Tooltip title="Oracle Fusion" placement="bottom">
            <Button
              type="text"
              icon={<GlobalOutlined style={{ fontSize: 18, color: '#fff' }} />}
              style={{ color: '#fff' }}
              onClick={() => navigate('/oracle-fusion')}
            />
          </Tooltip>
          <Tooltip title={failedCount > 0 ? `${failedCount} GL journal validation failure(s) this session` : 'GL Validation Log'} placement="bottom">
            <Badge count={failedCount} size="small" offset={[-4, 4]}>
              <Button
                type="text"
                onClick={openValidationDrawer}
                style={{
                  color: '#fff',
                  background: failedCount > 0 ? 'rgba(255,77,79,0.25)' : undefined,
                  borderRadius: 4,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  paddingInline: 8,
                }}
              >
                <WarningOutlined style={{ fontSize: 15, color: failedCount > 0 ? '#ffccc7' : '#fff' }} />
                <span style={{ fontSize: 12, color: failedCount > 0 ? '#ffccc7' : 'rgba(255,255,255,0.85)' }}>
                  Errors
                </span>
              </Button>
            </Badge>
          </Tooltip>
          <SupportTicketButton />
          <Tooltip title="Autopilot Assistant">
            <Button
              type="text"
              icon={<RobotOutlined style={{ fontSize: 18 }} />}
              onClick={() => setAutopilotOpen(o => !o)}
              style={{
                color: '#1677ff',
                background: autopilotOpen ? 'rgba(22,119,255,0.12)' : 'transparent',
                border: 'none',
                width: 36,
                height: 36,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: 8,
              }}
            />
          </Tooltip>
          {fusionUser && (
            <Tooltip title={`Signed in to Oracle Fusion as ${fusionUser}`}>
              <Tag icon={<CloudOutlined />} color="green" style={{ marginLeft: 6, marginRight: 0, fontWeight: 600 }}>
                {fusionUser}
              </Tag>
            </Tooltip>
          )}
          <Tooltip title={user?.name || 'User Profile'}>
            <Dropdown menu={{ items: userMenuItems }} placement="bottomRight" trigger={['click']}>
              <Avatar
                size={32}
                src={user?.photo}
                icon={!user?.photo && <UserOutlined />}
                style={{ cursor: 'pointer', marginLeft: 8, border: '2px solid rgba(255,255,255,0.3)', background: !user?.photo ? '#1677ff' : undefined }}
              />
            </Dropdown>
          </Tooltip>
        </Space>
      </div>

      <Content>
        <Outlet />
      </Content>

      {/* iOS Install Instructions Modal */}
      <Modal
        title="Install Re-ERP App"
        open={showIOSModal}
        onCancel={() => setShowIOSModal(false)}
        footer={[
          <Button key="close" type="primary" onClick={() => setShowIOSModal(false)}>
            Got it!
          </Button>
        ]}
      >
        <div style={{ textAlign: 'center', padding: '20px 0' }}>
          <Text style={{ fontSize: 16, display: 'block', marginBottom: 24 }}>
            Install Re-ERP on your iPhone/iPad:
          </Text>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 20, textAlign: 'left' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <div style={{
                width: 40,
                height: 40,
                borderRadius: 8,
                background: '#f0f0f0',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}>
                <ShareAltOutlined style={{ fontSize: 20, color: '#0572CE' }} />
              </div>
              <div>
                <Text strong>Step 1:</Text>
                <Text style={{ display: 'block' }}>
                  Tap the <ShareAltOutlined /> Share button in Safari
                </Text>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <div style={{
                width: 40,
                height: 40,
                borderRadius: 8,
                background: '#f0f0f0',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}>
                <PlusSquareOutlined style={{ fontSize: 20, color: '#0572CE' }} />
              </div>
              <div>
                <Text strong>Step 2:</Text>
                <Text style={{ display: 'block' }}>
                  Scroll down and tap "Add to Home Screen"
                </Text>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <div style={{
                width: 40,
                height: 40,
                borderRadius: 8,
                background: REDWOOD_PRIMARY,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#fff',
                fontWeight: 'bold',
              }}>
                R
              </div>
              <div>
                <Text strong>Step 3:</Text>
                <Text style={{ display: 'block' }}>
                  Tap "Add" to install the app
                </Text>
              </div>
            </div>
          </div>
        </div>
      </Modal>

      <ProfileModal open={showProfile} onClose={() => setShowProfile(false)} />
      <ShowAndTellPanel open={showAndTellOpen} onClose={() => setShowAndTellOpen(false)} />
      <GlValidationErrorsDrawer />
      <NotificationPanel open={notifOpen} onClose={() => setNotifOpen(false)} />
      <ApprovalToastWatcher onOpenPanel={() => setNotifOpen(true)} />
      <Autopilot externalOpen={autopilotOpen} onExternalClose={() => setAutopilotOpen(false)} />
    </Layout>
  );
};

export default MainLayout;
