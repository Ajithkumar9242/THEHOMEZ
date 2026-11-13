import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Empty,
  Input,
  Result,
  Skeleton,
  Space,
  Typography,
} from 'antd';
import { ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type { ICategoryTreeItem } from '@thehomez/shared-types';
import { PermissionCode } from '@thehomez/shared-types';
import { ApiError } from '../../../services/api-client.js';
import { useAuth } from '../../../providers/AuthProvider.js';
import { categoryClient } from '../api/category-client.js';
import { CategoryTree } from '../components/CategoryTree.js';

function errorDescription(error: unknown): { title: string; message: string; permission: boolean } {
  if (error instanceof ApiError) {
    if (error.status === 401)
      return { title: 'Session expired', message: 'Sign in again to continue.', permission: false };
    if (error.status === 403)
      return {
        title: 'Permission denied',
        message: 'Your staff account does not have access to catalogue categories.',
        permission: true,
      };
    if (error.status === 404)
      return {
        title: 'Categories unavailable',
        message: 'The category resource could not be found.',
        permission: false,
      };
    if (error.status === 400 || error.status === 422)
      return { title: 'Invalid request', message: error.message, permission: false };
    if (error.status >= 500 || error.status === 0)
      return {
        title: 'Categories could not be loaded',
        message: 'The service is temporarily unavailable. Try again.',
        permission: false,
      };
    return { title: 'Request failed', message: error.message, permission: false };
  }
  if (error instanceof Error && error.name === 'AbortError')
    return { title: 'Request cancelled', message: 'The request was cancelled.', permission: false };
  return {
    title: 'Categories could not be loaded',
    message: 'Check the connection and try again.',
    permission: false,
  };
}

export function CategoryBrowserPage() {
  const { user } = useAuth();
  const canRead = user?.permissions.includes(PermissionCode.CATALOG_READ) ?? false;
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const includeInactive = searchParams.get('includeInactive') === 'true';
  const [categories, setCategories] = useState<ICategoryTreeItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [search, setSearch] = useState('');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!canRead) {
      setCategories([]);
      setError(null);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    void categoryClient
      .getTree({ includeInactive, signal: controller.signal })
      .then((result) => {
        if (!controller.signal.aborted) setCategories(result.categories);
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(reason);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [canRead, includeInactive, attempt]);

  const categoryById = useMemo(
    () =>
      new Map(
        categories.flatMap((root) =>
          [root, ...root.subcategories].map((item) => [item.id, item] as const),
        ),
      ),
    [categories],
  );
  const currentError = error ? errorDescription(error) : null;
  const permissionDenied = currentError?.permission || !canRead;

  return (
    <div className="category-page">
      <div className="category-page-heading">
        <div>
          <Typography.Text className="eyebrow">CATALOGUE</Typography.Text>
          <Typography.Title level={1}>Categories</Typography.Title>
          <Typography.Paragraph type="secondary">
            Read-only visibility into the persisted two-level category hierarchy.
          </Typography.Paragraph>
        </div>
        {canRead && (
          <Checkbox
            checked={includeInactive}
            onChange={(event) => {
              const next = new URLSearchParams(searchParams);
              if (event.target.checked) next.set('includeInactive', 'true');
              else next.delete('includeInactive');
              setSearchParams(next);
            }}
          >
            Include inactive
          </Checkbox>
        )}
      </div>

      {permissionDenied ? (
        <Result
          status="403"
          title="Permission required"
          subTitle="Your active staff account does not have CATALOG_READ. The category API was not requested."
        />
      ) : (
        <div className="category-browser-grid">
          <Card
            className="category-tree-card"
            variant="borderless"
            title="Category hierarchy"
            extra={
              <Typography.Text type="secondary">
                {categories.length} parent categories
              </Typography.Text>
            }
          >
            <Input
              allowClear
              prefix={<SearchOutlined />}
              placeholder="Search name, slug or description"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              aria-label="Search categories"
            />
            <div className="category-tree-content" aria-live="polite" aria-busy={loading}>
              {loading ? (
                <Skeleton active paragraph={{ rows: 5 }} />
              ) : currentError ? (
                <Alert
                  type={currentError.permission ? 'error' : 'warning'}
                  showIcon
                  role="alert"
                  message={currentError.title}
                  description={currentError.message}
                  action={
                    <Space direction="vertical">
                      <Button
                        icon={<ReloadOutlined />}
                        onClick={() => setAttempt((value) => value + 1)}
                      >
                        Retry
                      </Button>
                      {currentError.title === 'Session expired' && (
                        <Button type="link" onClick={() => navigate('/sign-in')}>
                          Sign in
                        </Button>
                      )}
                    </Space>
                  }
                />
              ) : categories.length === 0 ? (
                <Empty description="No categories found" />
              ) : (
                <CategoryTree
                  categories={categories}
                  search={search}
                  onSelect={(id) => {
                    const selected = categoryById.get(id);
                    if (selected)
                      navigate(
                        `/catalogue/categories/${encodeURIComponent(selected.slug)}${includeInactive ? '?includeInactive=true' : ''}`,
                      );
                  }}
                />
              )}
            </div>
          </Card>
          <Card className="category-detail-empty" variant="borderless">
            <Empty description="Select a category to view its details" />
          </Card>
        </div>
      )}
    </div>
  );
}
