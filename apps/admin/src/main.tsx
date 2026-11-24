import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { ConfigProvider } from 'antd';
import { App } from './app/App.js';
import './styles/admin.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ConfigProvider
      theme={{
        token: {
          colorPrimary: '#8b2626',
          colorInfo: '#2563eb',
          colorSuccess: '#059669',
          colorWarning: '#d97706',
          colorError: '#dc2626',
          colorText: '#0f172a',
          colorTextSecondary: '#475569',
          colorTextTertiary: '#94a3b8',
          colorBgBase: '#ffffff',
          colorBgContainer: '#ffffff',
          colorBgLayout: '#f8fafc',
          colorBorder: '#e2e8f0',
          colorBorderSecondary: '#f1f5f9',
          borderRadius: 8,
          borderRadiusLG: 12,
          borderRadiusSM: 6,
          fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
          fontSize: 14,
          lineHeight: 1.5,
          controlHeight: 36,
          wireframe: false,
        },
        components: {
          Card: {
            headerHeight: 48,
            colorBorderSecondary: '#e2e8f0',
            headerFontSize: 15,
            paddingLG: 20,
          },
          Button: {
            borderRadius: 7,
            controlHeight: 36,
            fontWeight: 500,
            primaryShadow: '0 1px 2px 0 rgb(139 38 38 / 0.15)',
          },
          Table: {
            headerBg: '#f8fafc',
            headerColor: '#475569',
            headerSplitColor: 'transparent',
            borderColor: '#f1f5f9',
            rowHoverBg: '#f8fafc',
            fontSize: 13,
            padding: 12,
          },
          Input: {
            borderRadius: 7,
            controlHeight: 36,
            colorBorder: '#cbd5e1',
          },
          Select: {
            borderRadius: 7,
            controlHeight: 36,
            colorBorder: '#cbd5e1',
          },
          InputNumber: {
            borderRadius: 7,
            controlHeight: 36,
            colorBorder: '#cbd5e1',
          },
          Segmented: {
            itemSelectedBg: '#ffffff',
            itemSelectedColor: '#0f172a',
            trackBg: '#f1f5f9',
            borderRadius: 8,
          },
          Tag: {
            borderRadiusSM: 5,
            fontSize: 12,
            lineHeight: 1.4,
          },
          Drawer: {
            colorBgElevated: '#ffffff',
          },
          Modal: {
            borderRadiusLG: 12,
            headerBg: '#ffffff',
          },
          Breadcrumb: {
            fontSize: 13,
            linkColor: '#64748b',
            itemColor: '#0f172a',
            separatorColor: '#94a3b8',
          },
          Tabs: {
            cardBg: '#f8fafc',
            itemSelectedColor: '#8b2626',
            inkBarColor: '#8b2626',
          },
          Pagination: {
            borderRadius: 6,
            itemActiveBg: '#ffffff',
          },
        },
      }}
    >
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </ConfigProvider>
  </React.StrictMode>,
);
