import { useMemo, useState } from 'react';
import {
  Avatar,
  Breadcrumb,
  Button,
  Drawer,
  Dropdown,
  Layout,
  Menu,
  Space,
  Tag,
  Tooltip,
  Typography,
  Grid,
} from 'antd';
import {
  AuditOutlined,
  BankOutlined,
  BarChartOutlined,
  BuildOutlined,
  CloseOutlined,
  ColumnWidthOutlined,
  DashboardOutlined,
  FileSearchOutlined,
  FolderOutlined,
  HomeOutlined,
  LogoutOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  MessageOutlined,
  NotificationOutlined,
  PayCircleOutlined,
  SafetyCertificateOutlined,
  SettingOutlined,
  ShopOutlined,
  ShoppingOutlined,
  TeamOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { useLocation, useNavigate } from 'react-router-dom';
import { PermissionCode } from '@thehomez/shared-types';
import { useAuth } from '../providers/AuthProvider.js';

const { Header, Sider, Content } = Layout;

interface AdminModuleItem {
  key: string;
  label: string;
  icon: React.ReactNode;
  group: 'Core' | 'Catalogue' | 'Operations' | 'Governance';
  enabled?: boolean;
}

const modules: AdminModuleItem[] = [
  { key: '/', label: 'Dashboard', icon: <DashboardOutlined />, group: 'Core', enabled: true },
  {
    key: '/catalogue/categories',
    label: 'Categories',
    icon: <FolderOutlined />,
    group: 'Catalogue',
  },
  { key: '/catalogue/products', label: 'Products', icon: <ShoppingOutlined />, group: 'Catalogue' },
  { key: '/catalogue/units', label: 'Units', icon: <ColumnWidthOutlined />, group: 'Catalogue' },
  { key: '/service-areas', label: 'Service Areas', icon: <BuildOutlined />, group: 'Operations' },
  { key: '/partners', label: 'Partners', icon: <ShopOutlined />, group: 'Operations' },
  {
    key: '/partner-applications',
    label: 'Applications',
    icon: <AuditOutlined />,
    group: 'Operations',
  },
  { key: '/customers', label: 'Customers', icon: <TeamOutlined />, group: 'Operations' },
  { key: '/orders', label: 'Orders', icon: <FileSearchOutlined />, group: 'Governance' },
  { key: '/finance', label: 'Finance', icon: <BankOutlined />, group: 'Governance' },
  { key: '/settlements', label: 'Settlements', icon: <PayCircleOutlined />, group: 'Governance' },
  { key: '/support', label: 'Support', icon: <MessageOutlined />, group: 'Governance' },
  {
    key: '/notifications',
    label: 'Notifications',
    icon: <NotificationOutlined />,
    group: 'Governance',
  },
  { key: '/reports', label: 'Reports', icon: <BarChartOutlined />, group: 'Governance' },
  { key: '/settings', label: 'Settings', icon: <SettingOutlined />, group: 'Governance' },
];

export function AdminLayout({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  const { user, signOut } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const screens = Grid.useBreakpoint();
  const isMobile = !screens.md;

  const active = modules.find(
    (item) =>
      location.pathname === item.key ||
      (item.key === '/catalogue/categories' &&
        (location.pathname === '/catalogue/categories' ||
          location.pathname.startsWith('/catalogue/categories/'))) ||
      (item.key === '/catalogue/products' && location.pathname.startsWith('/catalogue/products')) ||
      (item.key === '/catalogue/units' &&
        (location.pathname === '/catalogue/units' ||
          location.pathname.startsWith('/catalogue/units/'))) ||
      (item.key === '/service-areas' &&
        (location.pathname === '/service-areas' ||
          location.pathname.startsWith('/service-areas/'))) ||
      (item.key === '/customers' &&
        (location.pathname === '/customers' || location.pathname.startsWith('/customers/'))) ||
      (item.key === '/partner-applications' &&
        (location.pathname === '/partner-applications' ||
          location.pathname.startsWith('/partner-applications/'))) ||
      (item.key === '/partners' &&
        (location.pathname === '/partners' || location.pathname.startsWith('/partners/'))),
  );

  const breadcrumbItems = useMemo(
    () => [
      {
        title: (
          <Space size={4} onClick={() => navigate('/')} style={{ cursor: 'pointer' }}>
            <HomeOutlined />
            <span>Admin</span>
          </Space>
        ),
      },
      { title: active?.label || 'Workspace' },
    ],
    [active, navigate],
  );

  const isSuperAdmin = user?.roles?.includes('SUPER_ADMIN');

  const visibleModules = modules.filter((item) => {
    if (item.key === '/') return true;
    if (isSuperAdmin) return true;

    if (
      item.key === '/catalogue/categories' ||
      item.key === '/catalogue/products' ||
      item.key === '/catalogue/units'
    ) {
      return user?.permissions.includes(PermissionCode.CATALOG_READ);
    }
    if (item.key === '/service-areas') {
      return user?.permissions.includes(PermissionCode.SERVICE_AREA_READ);
    }
    if (item.key === '/customers') {
      return user?.permissions.includes(PermissionCode.CUSTOMER_READ);
    }
    if (item.key === '/partners' || item.key === '/partner-applications') {
      return user?.permissions.includes(PermissionCode.PARTNER_READ);
    }
    if (item.key === '/orders') {
      return user?.permissions.includes(PermissionCode.ORDER_READ);
    }
    if (item.key === '/finance') {
      return user?.permissions.includes(PermissionCode.FINANCE_READ);
    }
    if (item.key === '/settlements') {
      return (
        user?.permissions.includes(PermissionCode.FINANCE_READ) ||
        user?.permissions.includes(PermissionCode.SETTLEMENT_APPROVE)
      );
    }
    if (item.key === '/reports') {
      return user?.permissions.includes(PermissionCode.AUDIT_READ);
    }
    if (item.key === '/settings') {
      return (
        user?.permissions.includes(PermissionCode.SETTINGS_WRITE) ||
        user?.permissions.includes(PermissionCode.RBAC_MANAGE)
      );
    }
    return false;
  });

  const isOperationalItem = (key: string, enabled?: boolean) =>
    Boolean(
      enabled ||
      key === '/catalogue/categories' ||
      key === '/catalogue/products' ||
      key === '/catalogue/units' ||
      key === '/service-areas' ||
      key === '/customers' ||
      key === '/partners' ||
      key === '/partner-applications',
    );

  const handleNavClick = (key: string) => {
    const item = modules.find((module) => module.key === key);
    if (item && isOperationalItem(item.key, item.enabled)) {
      navigate(item.key);
      if (isMobile) {
        setMobileDrawerOpen(false);
      }
    }
  };

  const navMenuItems = useMemo(() => {
    if (collapsed && !isMobile) {
      return visibleModules.map((item) => ({
        key: item.key,
        icon: item.icon,
        label: item.label,
        disabled: !isOperationalItem(item.key, item.enabled),
      }));
    }

    const sectionGroups: {
      group: 'Core' | 'Catalogue' | 'Operations' | 'Governance';
      title: string;
    }[] = [
      { group: 'Core', title: 'Overview' },
      { group: 'Catalogue', title: 'Catalogue' },
      { group: 'Operations', title: 'Operations & Network' },
      { group: 'Governance', title: 'Commerce & Platform' },
    ];

    return sectionGroups
      .map(({ group, title }) => {
        const groupItems = visibleModules.filter((m) => m.group === group);
        if (groupItems.length === 0) return null;

        return {
          type: 'group' as const,
          label: (
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
                color: '#64748b',
                paddingLeft: 4,
              }}
            >
              {title}
            </span>
          ),
          children: groupItems.map((item) => {
            const isOperational = isOperationalItem(item.key, item.enabled);
            return {
              key: item.key,
              icon: item.icon,
              label: isOperational ? (
                item.label
              ) : (
                <span
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}
                >
                  <span>{item.label}</span>
                  <span className="nav-status">Soon</span>
                </span>
              ),
              disabled: !isOperational,
            };
          }),
        };
      })
      .filter((g): g is NonNullable<typeof g> => g !== null);
  }, [collapsed, isMobile, visibleModules]);

  const userMenuItems = [
    {
      key: 'user-info',
      disabled: true,
      label: (
        <div style={{ padding: '4px 0', minWidth: 180 }}>
          <Typography.Text strong style={{ display: 'block', color: '#0f172a' }}>
            {user?.email || 'Staff Account'}
          </Typography.Text>
          <Typography.Text type="secondary" style={{ fontSize: 11 }}>
            {user?.phone || 'No phone registered'}
          </Typography.Text>
          <div style={{ marginTop: 6 }}>
            {isSuperAdmin ? (
              <Tag color="purple" style={{ borderRadius: 10, fontSize: 10, fontWeight: 600 }}>
                SUPER ADMIN
              </Tag>
            ) : (
              <Tag color="blue" style={{ borderRadius: 10, fontSize: 10, fontWeight: 600 }}>
                {user?.roles?.[0] || 'STAFF'}
              </Tag>
            )}
          </div>
        </div>
      ),
    },
    { type: 'divider' as const },
    {
      key: 'dashboard',
      icon: <DashboardOutlined />,
      label: 'Dashboard Overview',
      onClick: () => navigate('/'),
    },
    {
      key: 'sign-out',
      icon: <LogoutOutlined style={{ color: '#ef4444' }} />,
      danger: true,
      label: 'Sign out',
      onClick: () => void signOut(),
    },
  ];

  const brandLockup = (
    <div className="brand-lockup" onClick={() => navigate('/')} style={{ cursor: 'pointer' }}>
      <span className="brand-mark">H</span>
      {(!collapsed || isMobile) && (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <span className="brand-title">
            TheHomez <small>ADMIN</small>
          </span>
          <span
            style={{
              fontSize: 10,
              color: '#94a3b8',
              letterSpacing: '0.04em',
              lineHeight: 1,
              marginTop: 2,
            }}
          >
            OPERATIONS CONSOLE
          </span>
        </div>
      )}
    </div>
  );

  return (
    <Layout className="admin-frame">
      {/* Desktop Persistent Sider */}
      {!isMobile && (
        <Sider
          className="admin-sider"
          collapsible
          collapsed={collapsed}
          onCollapse={setCollapsed}
          trigger={null}
          width={240}
          collapsedWidth={72}
        >
          {brandLockup}
          <div className="admin-sider-menu-wrapper">
            <Menu
              theme="dark"
              mode="inline"
              selectedKeys={[active?.key || location.pathname]}
              onClick={({ key }) => handleNavClick(key)}
              items={navMenuItems as any}
            />
          </div>
          {!collapsed && (
            <div className="sidebar-footnote">
              <Space size={6} align="center">
                <SafetyCertificateOutlined style={{ color: '#10b981' }} />
                <span>Enterprise RBAC active</span>
              </Space>
            </div>
          )}
        </Sider>
      )}

      {/* Mobile Off-Canvas Drawer */}
      {isMobile && (
        <Drawer
          title={null}
          placement="left"
          closable={false}
          onClose={() => setMobileDrawerOpen(false)}
          open={mobileDrawerOpen}
          styles={{ body: { padding: 0, background: '#0f172a' } }}
          width={260}
        >
          <div className="admin-sider" style={{ height: '100%', minHeight: '100%' }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                paddingRight: 12,
              }}
            >
              {brandLockup}
              <Button
                type="text"
                icon={<CloseOutlined style={{ color: '#94a3b8' }} />}
                onClick={() => setMobileDrawerOpen(false)}
                aria-label="Close navigation"
              />
            </div>
            <div className="admin-sider-menu-wrapper">
              <Menu
                theme="dark"
                mode="inline"
                selectedKeys={[active?.key || location.pathname]}
                onClick={({ key }) => handleNavClick(key)}
                items={navMenuItems as any}
              />
            </div>
          </div>
        </Drawer>
      )}

      <Layout>
        <Header className="admin-header">
          <div className="header-left">
            <Tooltip title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
              <Button
                aria-label={
                  isMobile
                    ? 'Open navigation menu'
                    : collapsed
                      ? 'Expand navigation'
                      : 'Collapse navigation'
                }
                type="text"
                onClick={() => {
                  if (isMobile) {
                    setMobileDrawerOpen(true);
                  } else {
                    setCollapsed(!collapsed);
                  }
                }}
                icon={
                  isMobile ? (
                    <MenuUnfoldOutlined />
                  ) : collapsed ? (
                    <MenuUnfoldOutlined />
                  ) : (
                    <MenuFoldOutlined />
                  )
                }
                style={{ fontSize: 16, width: 36, height: 36 }}
              />
            </Tooltip>
            <Tag
              bordered={false}
              style={{
                background: 'rgba(217, 119, 6, 0.08)',
                color: '#d97706',
                fontWeight: 600,
                borderRadius: 20,
                padding: '2px 10px',
                fontSize: 11,
                letterSpacing: '0.04em',
                border: '1px solid rgba(217, 119, 6, 0.2)',
              }}
            >
              DEVELOPMENT
            </Tag>
          </div>
          <Space size="middle" className="identity-area">
            {isSuperAdmin && (
              <Tag
                bordered={false}
                style={{
                  background: 'rgba(126, 34, 206, 0.08)',
                  color: '#7e22ce',
                  fontWeight: 600,
                  borderRadius: 20,
                  padding: '2px 10px',
                  fontSize: 11,
                  border: '1px solid rgba(126, 34, 206, 0.2)',
                }}
              >
                SUPER ADMIN
              </Tag>
            )}
            <Dropdown menu={{ items: userMenuItems }} trigger={['click']} placement="bottomRight">
              <Space
                align="center"
                style={{ cursor: 'pointer', padding: '4px 8px', borderRadius: 8 }}
                className="user-profile-trigger"
                aria-label="User profile menu"
              >
                <div className="identity-copy">
                  <Typography.Text strong style={{ fontSize: 13, color: '#0f172a' }}>
                    {user?.email || 'Staff account'}
                  </Typography.Text>
                  <Typography.Text type="secondary" style={{ fontSize: 11, color: '#64748b' }}>
                    {isSuperAdmin ? 'Platform Owner' : user?.roles?.[0] || 'Staff'}
                  </Typography.Text>
                </div>
                <Avatar
                  icon={<UserOutlined />}
                  aria-hidden="true"
                  style={{
                    backgroundColor: isSuperAdmin ? '#7e22ce' : '#1e293b',
                    border: '1px solid #e2e8f0',
                    transition: 'all 0.2s ease',
                  }}
                >
                  {user?.email?.[0]?.toUpperCase() || 'A'}
                </Avatar>
              </Space>
            </Dropdown>
          </Space>
        </Header>
        <Content className="admin-content">
          <div className="breadcrumb-wrapper">
            <Breadcrumb items={breadcrumbItems} />
          </div>
          <div className="page-content">{children}</div>
          <footer className="admin-footer">
            <Space split={<span>·</span>} size="middle" wrap>
              <span>TheHomez Admin v1.0</span>
              <span>Enterprise RBAC Enforced</span>
              <span>Logged in as {user?.email}</span>
            </Space>
          </footer>
        </Content>
      </Layout>
    </Layout>
  );
}
