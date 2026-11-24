import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Empty,
  Input,
  Result,
  Segmented,
  Skeleton,
  Space,
  Typography,
} from 'antd';
import { PlusOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type {
  ICategory,
  ICategoryDetailsResponse,
  ICategorySubcategoryItem,
  ICategoryTreeItem,
} from '@thehomez/shared-types';
import { PermissionCode } from '@thehomez/shared-types';
import { ApiError } from '../../../services/api-client.js';
import { useAuth } from '../../../providers/AuthProvider.js';
import { categoryClient } from '../api/category-client.js';
import { CategoryTree } from '../components/CategoryTree.js';
import { CategoryDetails } from '../components/CategoryDetails.js';
import { CategoryFormModal } from '../components/CategoryFormModal.js';
import { CategoryDeleteModal } from '../components/CategoryDeleteModal.js';

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
  const canWrite = user?.permissions.includes(PermissionCode.CATALOG_WRITE) ?? false;
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const includeInactive = searchParams.get('includeInactive') === 'true';
  const [categories, setCategories] = useState<ICategoryTreeItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [search, setSearch] = useState('');
  const [attempt, setAttempt] = useState(0);

  // Management modal state
  const [formModalOpen, setFormModalOpen] = useState(false);
  const [formModalMode, setFormModalMode] = useState<'create' | 'edit'>('create');
  const [selectedCategory, setSelectedCategory] = useState<
    ICategory | ICategoryTreeItem | ICategorySubcategoryItem | null
  >(null);
  const [initialParentId, setInitialParentId] = useState<string | null>(null);
  const [hasChildren, setHasChildren] = useState(false);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [categoryToDelete, setCategoryToDelete] = useState<{ id: string; name: string } | null>(
    null,
  );

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

  const handleOpenCreateRoot = () => {
    setSelectedCategory(null);
    setInitialParentId(null);
    setHasChildren(false);
    setFormModalMode('create');
    setFormModalOpen(true);
  };

  const handleOpenAddSubcategory = (root: ICategoryTreeItem) => {
    setSelectedCategory(null);
    setInitialParentId(root.id);
    setHasChildren(false);
    setFormModalMode('create');
    setFormModalOpen(true);
  };

  const handleOpenEdit = (cat: ICategory | ICategoryTreeItem | ICategorySubcategoryItem) => {
    const root = categories.find((r) => r.id === cat.id);
    const kidsExist = Boolean(root && root.subcategories && root.subcategories.length > 0);
    setSelectedCategory(cat);
    setInitialParentId(cat.parentId || null);
    setHasChildren(kidsExist);
    setFormModalMode('edit');
    setFormModalOpen(true);
  };

  const handleOpenDelete = (cat: ICategory | ICategoryTreeItem | ICategorySubcategoryItem) => {
    setCategoryToDelete({ id: cat.id, name: cat.name });
    setDeleteModalOpen(true);
  };

  const stats = useMemo(() => {
    let rootCount = 0;
    let subCount = 0;
    let activeCount = 0;
    let inactiveCount = 0;

    for (const root of categories) {
      rootCount++;
      if (root.isActive) activeCount++;
      else inactiveCount++;

      for (const sub of root.subcategories) {
        subCount++;
        if (sub.isActive) activeCount++;
        else inactiveCount++;
      }
    }

    return {
      total: rootCount + subCount,
      root: rootCount,
      subcategories: subCount,
      active: activeCount,
      inactive: inactiveCount,
    };
  }, [categories]);

  const [statusFilter, setStatusFilter] = useState<'ALL' | 'ACTIVE' | 'INACTIVE'>('ALL');
  const [selectedDetailId, setSelectedDetailId] = useState<string | null>(null);

  const selectedDetails = useMemo<ICategoryDetailsResponse | null>(() => {
    if (!selectedDetailId) return null;
    const item = categoryById.get(selectedDetailId);
    if (!item) return null;

    if (item.level === 0) {
      const rootItem = item as ICategoryTreeItem;
      return {
        category: {
          id: rootItem.id,
          slug: rootItem.slug,
          name: rootItem.name,
          description: rootItem.description,
          parentId: null,
          level: 0,
          displayOrder: rootItem.displayOrder,
          isActive: rootItem.isActive,
          iconUrl: rootItem.iconUrl,
          imageUrl: rootItem.imageUrl,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        subcategories: rootItem.subcategories,
        parent: null,
      };
    } else {
      const subItem = item as ICategorySubcategoryItem;
      const parentRoot = categories.find((r) => r.id === subItem.parentId);
      return {
        category: {
          id: subItem.id,
          slug: subItem.slug,
          name: subItem.name,
          description: subItem.description,
          parentId: subItem.parentId,
          level: 1,
          displayOrder: subItem.displayOrder,
          isActive: subItem.isActive,
          iconUrl: subItem.iconUrl,
          imageUrl: subItem.imageUrl,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        subcategories: [],
        parent: parentRoot
          ? {
              id: parentRoot.id,
              slug: parentRoot.slug,
              name: parentRoot.name,
              description: parentRoot.description,
              parentId: null,
              level: 0,
              displayOrder: parentRoot.displayOrder,
              isActive: parentRoot.isActive,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            }
          : null,
      };
    }
  }, [selectedDetailId, categoryById, categories]);

  return (
    <div className="category-page">
      <div className="category-page-heading">
        <div>
          <Typography.Text className="eyebrow">CATALOGUE</Typography.Text>
          <Typography.Title level={1}>Categories</Typography.Title>
          <Typography.Paragraph type="secondary">
            {canWrite
              ? 'Manage root categories, subcategories, display order and active status.'
              : 'Read-only visibility into the persisted two-level category hierarchy.'}
          </Typography.Paragraph>
        </div>
        <Space>
          {canWrite && (
            <Button type="primary" icon={<PlusOutlined />} onClick={handleOpenCreateRoot}>
              Add category
            </Button>
          )}
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
          <Button
            icon={<ReloadOutlined />}
            onClick={() => setAttempt((value) => value + 1)}
            aria-label="Refresh categories"
          >
            Refresh
          </Button>
        </Space>
      </div>

      {!canWrite && canRead && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 20 }}
          message="Read-Only Catalogue View"
          description="Your staff account has CATALOG_READ permission. You can explore categories, subcategories, and active statuses. Creating or modifying taxonomy requires CATALOG_WRITE permission."
        />
      )}

      {canRead && !permissionDenied && (
        <div className="category-stats-grid">
          <div className="category-stat-card">
            <div className="category-stat-label">Total Categories</div>
            <div className="category-stat-value">{stats.total}</div>
          </div>
          <div className="category-stat-card">
            <div className="category-stat-label">Root Categories</div>
            <div className="category-stat-value">{stats.root}</div>
          </div>
          <div className="category-stat-card">
            <div className="category-stat-label">Subcategories</div>
            <div className="category-stat-value">{stats.subcategories}</div>
          </div>
          <div className="category-stat-card">
            <div className="category-stat-label">Active Records</div>
            <div className="category-stat-value" style={{ color: '#16a34a' }}>
              {stats.active}
            </div>
          </div>
          <div className="category-stat-card">
            <div className="category-stat-label">Inactive Records</div>
            <div
              className="category-stat-value"
              style={{ color: stats.inactive > 0 ? '#ea580c' : '#64748b' }}
            >
              {stats.inactive}
            </div>
          </div>
        </div>
      )}

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
            {includeInactive && (
              <Segmented
                className="category-filter-segmented"
                value={statusFilter}
                onChange={(val) => setStatusFilter(val as 'ALL' | 'ACTIVE' | 'INACTIVE')}
                options={[
                  { label: `All (${stats.total})`, value: 'ALL' },
                  { label: `Active (${stats.active})`, value: 'ACTIVE' },
                  { label: `Inactive (${stats.inactive})`, value: 'INACTIVE' },
                ]}
                block
              />
            )}
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
                  statusFilter={statusFilter}
                  canWrite={canWrite}
                  onAddSubcategory={handleOpenAddSubcategory}
                  onEdit={handleOpenEdit}
                  onDelete={handleOpenDelete}
                  onSelect={(id) => {
                    setSelectedDetailId(id);
                  }}
                />
              )}
            </div>
          </Card>
          {selectedDetails ? (
            <CategoryDetails
              details={selectedDetails}
              canWrite={canWrite}
              onClose={() => setSelectedDetailId(null)}
              onViewPage={() =>
                navigate(
                  `/catalogue/categories/${encodeURIComponent(selectedDetails.category.slug)}${includeInactive ? '?includeInactive=true' : ''}`,
                )
              }
              onEdit={() => handleOpenEdit(selectedDetails.category)}
              onDelete={() => handleOpenDelete(selectedDetails.category)}
              onAddSubcategory={() => {
                const rootItem = categories.find((r) => r.id === selectedDetails.category.id);
                if (rootItem) handleOpenAddSubcategory(rootItem);
              }}
              onEditChild={(child) => handleOpenEdit(child)}
              onDeleteChild={(child) => handleOpenDelete(child)}
            />
          ) : (
            <Card className="category-detail-empty" variant="borderless">
              <Empty description="Select a category to view its details" />
            </Card>
          )}
        </div>
      )}

      {canWrite && formModalOpen && (
        <CategoryFormModal
          open={formModalOpen}
          mode={formModalMode}
          category={selectedCategory}
          initialParentId={initialParentId}
          rootCategories={categories.map((c) => ({ id: c.id, name: c.name }))}
          hasChildren={hasChildren}
          onClose={() => setFormModalOpen(false)}
          onSuccess={() => {
            setAttempt((n) => n + 1);
          }}
        />
      )}
      {canWrite && deleteModalOpen && (
        <CategoryDeleteModal
          open={deleteModalOpen}
          category={categoryToDelete}
          onClose={() => {
            setDeleteModalOpen(false);
            setCategoryToDelete(null);
          }}
          onSuccess={() => {
            setAttempt((n) => n + 1);
          }}
        />
      )}
    </div>
  );
}
