import { useMemo, useState } from 'react';
import { Avatar, Breadcrumb, Button, Layout, Menu, Space, Tag, Typography, Grid } from 'antd';
import {
  AppstoreOutlined,
  BankOutlined,
  BellOutlined,
  BuildOutlined,
  DashboardOutlined,
  FileSearchOutlined,
  LogoutOutlined,
  MessageOutlined,
  NotificationOutlined,
  SettingOutlined,
  ShopOutlined,
  TeamOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { useLocation, useNavigate } from 'react-router-dom';
import { PermissionCode } from '@thehomez/shared-types';
import { useAuth } from '../providers/AuthProvider.js';

const { Header, Sider, Content } = Layout;
const modules = [
  { key: '/', label: 'Dashboard', icon: <DashboardOutlined />, enabled: true },
  { key: '/catalogue/categories', label: 'Catalogue', icon: <AppstoreOutlined /> },
  { key: '/catalogue/products', label: 'Products', icon: <AppstoreOutlined /> },
  { key: '/catalogue/units', label: 'Units', icon: <AppstoreOutlined /> },
  { key: '/service-areas', label: 'Service Areas', icon: <BuildOutlined /> },
  { key: '/customers', label: 'Customers', icon: <TeamOutlined /> },
  { key: '/partners', label: 'Partners', icon: <ShopOutlined /> },
  { key: '/orders', label: 'Orders', icon: <FileSearchOutlined /> },
  { key: '/finance', label: 'Finance', icon: <BankOutlined /> },
  { key: '/settlements', label: 'Settlements', icon: <BankOutlined /> },
  { key: '/support', label: 'Support', icon: <MessageOutlined /> },
  { key: '/notifications', label: 'Notifications', icon: <NotificationOutlined /> },
  { key: '/reports', label: 'Reports', icon: <BellOutlined /> },
  { key: '/settings', label: 'Settings', icon: <SettingOutlined /> },
];

export function AdminLayout({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const { user, signOut } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const screens = Grid.useBreakpoint();
  const active = modules.find(
    (item) =>
      location.pathname === item.key ||
      (item.key === '/catalogue/categories' &&
        location.pathname.startsWith('/catalogue/categories/')) ||
      (item.key === '/catalogue/products' && location.pathname.startsWith('/catalogue/products')) ||
      (item.key === '/catalogue/units' && location.pathname.startsWith('/catalogue/units/')) ||
      (item.key === '/service-areas' && location.pathname.startsWith('/service-areas/')) ||
      (item.key === '/customers' && location.pathname.startsWith('/customers')),
  );
  const breadcrumbItems = useMemo(
    () => [{ title: 'Admin' }, { title: active?.label || 'Workspace' }],
    [active],
  );
  const visibleModules = modules.filter((item) => {
    if (item.key === '/catalogue/categories' || item.key === '/catalogue/products') {
      return user?.permissions.includes(PermissionCode.CATALOG_READ);
    }
    if (item.key === '/service-areas') {
      return user?.permissions.includes(PermissionCode.SERVICE_AREA_READ);
    }
    if (item.key === '/customers') {
      return user?.permissions.includes(PermissionCode.CUSTOMER_READ);
    }
    return true;
  });

  return (
    <Layout className="admin-frame">
      <Sider
        className="admin-sider"
        collapsible
        collapsed={collapsed}
        onCollapse={setCollapsed}
        breakpoint="lg"
        onBreakpoint={(broken) => setCollapsed(broken)}
        width={248}
        collapsedWidth={screens.md ? 80 : 0}
      >
        <div className="brand-lockup">
          <span className="brand-mark">H</span>
          {!collapsed && (
            <span className="brand-title">
              TheHomez <small>ADMIN</small>
            </span>
          )}
        </div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[active?.key || location.pathname]}
          onClick={({ key }) => {
            const item = modules.find((module) => module.key === key);
            if (
              item?.enabled ||
              item?.key === '/catalogue/categories' ||
              item?.key === '/catalogue/products' ||
              item?.key === '/catalogue/units' ||
              item?.key === '/service-areas' ||
              item?.key === '/customers'
            )
              navigate(item.key);
          }}
          items={visibleModules.map((item) => {
            const isOperational =
              item.enabled ||
              item.key === '/catalogue/categories' ||
              item.key === '/catalogue/products' ||
              item.key === '/catalogue/units' ||
              item.key === '/service-areas' ||
              item.key === '/customers';

            return {
              key: item.key,
              icon: item.icon,
              label: isOperational ? (
                item.label
              ) : (
                <span>
                  {item.label}
                  <small className="nav-status">In development</small>
                </span>
              ),
              disabled: !isOperational,
            };
          })}
        />
        {!collapsed && (
          <div className="sidebar-footnote">
            Operational modules are enabled only after their requirements and APIs are ready.
          </div>
        )}
      </Sider>
      <Layout>
        <Header className="admin-header">
          <div className="header-left">
            <Button
              aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}
              type="text"
              onClick={() => setCollapsed(!collapsed)}
              icon={<AppstoreOutlined />}
            />
            <Tag color="gold">DEVELOPMENT</Tag>
          </div>
          <Space size="middle" className="identity-area">
            <div className="identity-copy">
              <Typography.Text strong>{user?.email || 'Staff account'}</Typography.Text>
              <Typography.Text type="secondary">{user?.phone}</Typography.Text>
            </div>
            <Avatar icon={<UserOutlined />} aria-hidden="true" />
            <Button icon={<LogoutOutlined />} onClick={() => void signOut()}>
              Sign out
            </Button>
          </Space>
        </Header>
        <Content className="admin-content">
          <Breadcrumb items={breadcrumbItems} />
          <div className="page-content">{children}</div>
          <footer className="admin-footer">
            TheHomez Admin · Development foundation · Staff access is checked by the backend
          </footer>
        </Content>
      </Layout>
    </Layout>
  );
}
