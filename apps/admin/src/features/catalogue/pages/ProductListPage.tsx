import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Empty,
  Input,
  Select,
  Skeleton,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd';
import { ClearOutlined, PlusOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  PermissionCode,
  type ICategoryTreeItem,
  type IProduct,
  type ProductStatus as ProductState,
} from '@thehomez/shared-types';
import { ApiError } from '../../../services/api-client.js';
import { useAuth } from '../../../providers/AuthProvider.js';
import { productClient } from '../api/product-client.js';
import { getCategories, getUnitLabels } from '../api/catalogue-lookups.js';
import { CatalogueError } from '../components/CatalogueStates.js';
import { ProductStatus as ProductStatusTag } from '../components/ProductStatus.js';
import { ProductFormDrawer } from '../components/ProductFormDrawer.js';
import {
  ProductLifecycleModal,
  type ProductLifecycleAction,
} from '../components/ProductLifecycleModal.js';

const statuses: ProductState[] = ['DRAFT', 'ACTIVE', 'INACTIVE', 'ARCHIVED'];
export function ProductListPage() {
  const { user } = useAuth();
  const canRead = user?.permissions.includes(PermissionCode.CATALOG_READ) ?? false;
  const canWrite = user?.permissions.includes(PermissionCode.CATALOG_WRITE) ?? false;
  const canPublish = user?.permissions.includes(PermissionCode.CATALOG_PUBLISH) ?? false;
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const page = Math.max(1, Number(params.get('page')) || 1);
  const limit = Math.min(100, Math.max(1, Number(params.get('limit')) || 20));
  const [search, setSearch] = useState(params.get('search') || '');
  const [status, setStatus] = useState<ProductState | undefined>(
    (params.get('status') as ProductState | null) || undefined,
  );
  const [categoryId, setCategoryId] = useState(params.get('categoryId') || undefined);
  const [subcategoryId, setSubcategoryId] = useState(params.get('subcategoryId') || undefined);
  const [brand, setBrand] = useState(params.get('brand') || '');
  const [applied, setApplied] = useState<{
    search: string;
    status?: ProductState;
    categoryId?: string;
    subcategoryId?: string;
    brand: string;
  }>({
    search: params.get('search') || '',
    status: (params.get('status') as ProductState | null) || undefined,
    categoryId: params.get('categoryId') || undefined,
    subcategoryId: params.get('subcategoryId') || undefined,
    brand: params.get('brand') || '',
  });
  const [rows, setRows] = useState<IProduct[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [categories, setCategories] = useState<Map<string, string>>(new Map());
  const [units, setUnits] = useState<Map<string, string>>(new Map());
  const [categoryTree, setCategoryTree] = useState<ICategoryTreeItem[]>([]);
  const [lookupError, setLookupError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);

  // Management UI State
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerMode, setDrawerMode] = useState<'create' | 'edit'>('create');
  const [selectedProduct, setSelectedProduct] = useState<IProduct | null>(null);
  const [lifecycleAction, setLifecycleAction] = useState<ProductLifecycleAction | null>(null);
  const [lifecycleModalOpen, setLifecycleModalOpen] = useState(false);

  useEffect(() => {
    if (!canRead) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLookupError(false);
    void getCategories(controller.signal)
      .then(({ labels, tree }) => {
        if (!controller.signal.aborted) {
          setCategories(labels);
          setCategoryTree(tree);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setLookupError(true);
      });
    void getUnitLabels(controller.signal)
      .then((labels) => {
        if (!controller.signal.aborted) setUnits(labels);
      })
      .catch(() => {
        if (!controller.signal.aborted) setLookupError(true);
      });
    return () => controller.abort();
  }, [canRead, attempt]);

  useEffect(() => {
    if (!canRead) {
      setRows([]);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    void productClient
      .list({ page, limit, ...applied, signal: controller.signal })
      .then((result) => {
        if (!controller.signal.aborted) {
          setRows(result.items);
          setTotal(result.total);
          setTotalPages(result.totalPages);
        }
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(reason);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [canRead, page, limit, applied, attempt]);

  const subcategories = useMemo(
    () => categoryTree.find((root) => root.id === categoryId)?.subcategories || [],
    [categoryTree, categoryId],
  );
  const updateParams = (nextPage: number, nextLimit: number, filters = applied) => {
    const next = new URLSearchParams();
    next.set('page', String(nextPage));
    next.set('limit', String(nextLimit));
    for (const [key, value] of Object.entries(filters)) if (value) next.set(key, value);
    setParams(next);
  };
  const applyFilters = () => {
    const next = { search: search.trim(), status, categoryId, subcategoryId, brand: brand.trim() };
    setApplied(next);
    updateParams(1, limit, next);
  };
  const clearFilters = () => {
    setSearch('');
    setStatus(undefined);
    setCategoryId(undefined);
    setSubcategoryId(undefined);
    setBrand('');
    const empty = {
      search: '',
      status: undefined,
      categoryId: undefined,
      subcategoryId: undefined,
      brand: '',
    };
    setApplied(empty);
    updateParams(1, limit, empty);
  };

  if (!canRead)
    return (
      <Alert
        type="error"
        showIcon
        message="CATALOG_READ permission required"
        description="The product API was not requested."
      />
    );
  const apiError = error instanceof ApiError ? error : null;
  if (apiError?.status === 401 || apiError?.status === 403)
    return (
      <CatalogueError error={error} retry={() => setAttempt((n) => n + 1)} resource="products" />
    );
  return (
    <div className="catalogue-page">
      <div className="catalogue-heading">
        <div>
          <Typography.Text className="eyebrow">CATALOGUE</Typography.Text>
          <Typography.Title level={1}>Products</Typography.Title>
          <Typography.Paragraph type="secondary">
            Master product and variant catalogue governance.
          </Typography.Paragraph>
        </div>
        <Space>
          {canWrite && (
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => {
                setSelectedProduct(null);
                setDrawerMode('create');
                setDrawerOpen(true);
              }}
              aria-label="Create product button"
            >
              Create Product
            </Button>
          )}
          <Tag>{total.toLocaleString()} products</Tag>
        </Space>
      </div>
      <Card variant="borderless" className="catalogue-card">
        <div className="product-filters">
          <Input
            allowClear
            value={search}
            prefix={<SearchOutlined />}
            placeholder="Search products"
            aria-label="Search products"
            onChange={(e) => setSearch(e.target.value)}
            onPressEnter={applyFilters}
          />
          <Select
            allowClear
            placeholder="All statuses"
            aria-label="Filter by status"
            value={status}
            onChange={setStatus}
            options={statuses.map((value) => ({ value, label: value }))}
          />
          <Select
            allowClear
            showSearch
            optionFilterProp="label"
            placeholder="All categories"
            aria-label="Filter by category"
            value={categoryId}
            onChange={(value) => {
              setCategoryId(value);
              setSubcategoryId(undefined);
            }}
            options={categoryTree.map((root) => ({ value: root.id, label: root.name }))}
          />
          <Select
            allowClear
            showSearch
            optionFilterProp="label"
            placeholder="All subcategories"
            aria-label="Filter by subcategory"
            value={subcategoryId}
            onChange={setSubcategoryId}
            disabled={!categoryId}
            options={subcategories.map((item) => ({ value: item.id, label: item.name }))}
          />
          <Input
            allowClear
            value={brand}
            placeholder="Brand"
            aria-label="Filter by brand"
            onChange={(e) => setBrand(e.target.value)}
            onPressEnter={applyFilters}
          />
          <Space>
            <Button type="primary" onClick={applyFilters}>
              Apply filters
            </Button>
            <Button icon={<ClearOutlined />} onClick={clearFilters}>
              Reset
            </Button>
          </Space>
        </div>
        {lookupError && (
          <Alert
            type="info"
            showIcon
            className="lookup-note"
            message="Some category labels are unavailable; IDs will be shown where needed."
          />
        )}
        {loading ? (
          <Skeleton active paragraph={{ rows: 7 }} />
        ) : error ? (
          <CatalogueError
            error={error}
            retry={() => setAttempt((n) => n + 1)}
            resource="products"
          />
        ) : rows.length === 0 ? (
          <Empty description="No products match these filters" />
        ) : (
          <Table<IProduct>
            rowKey="id"
            dataSource={rows}
            scroll={{ x: 1000 }}
            pagination={{
              current: page,
              pageSize: limit,
              total,
              showSizeChanger: true,
              pageSizeOptions: [10, 20, 50, 100],
              showTotal: (count) => `${count} products`,
              onChange: (nextPage, nextLimit) => updateParams(nextPage, nextLimit),
            }}
            onRow={(record) => ({
              onClick: () => navigate(`/catalogue/products/${encodeURIComponent(record.id)}`),
              className: 'catalogue-row',
            })}
            columns={[
              {
                title: 'Product',
                dataIndex: 'title',
                key: 'title',
                render: (title: string, item) => (
                  <Space direction="vertical" size={0}>
                    <Typography.Text strong>{title}</Typography.Text>
                    <Typography.Text type="secondary">{item.slug}</Typography.Text>
                  </Space>
                ),
              },
              { title: 'Brand', dataIndex: 'brand', key: 'brand' },
              {
                title: 'SKU',
                dataIndex: 'sku',
                key: 'sku',
                render: (sku: string | null) =>
                  sku ? <span className="sku-cell">{sku}</span> : '—',
              },
              {
                title: 'Category',
                key: 'category',
                render: (_, item) => (
                  <Space direction="vertical" size={0}>
                    <span>{categories.get(item.categoryId) || 'Unavailable'}</span>
                    <Typography.Text type="secondary">
                      {categories.get(item.subcategoryId) || 'Unavailable'}
                    </Typography.Text>
                  </Space>
                ),
              },
              {
                title: 'Unit',
                dataIndex: 'unitCode',
                key: 'unit',
                render: (unit: string | null | undefined) =>
                  unit ? `${units.get(unit) || 'Unavailable'} · ${unit}` : '—',
              },
              {
                title: 'Type',
                dataIndex: 'hasVariants',
                key: 'variants',
                render: (has: boolean) => (has ? <Tag color="blue">Variants</Tag> : 'Single item'),
              },
              {
                title: 'Status',
                dataIndex: 'status',
                key: 'status',
                render: (state: ProductState) => <ProductStatusTag status={state} />,
              },
              {
                title: 'Created',
                dataIndex: 'createdAt',
                key: 'created',
                render: (date?: string) => (date ? new Date(date).toLocaleDateString() : '—'),
              },
              ...(canWrite || canPublish
                ? [
                    {
                      title: 'Actions',
                      key: 'actions',
                      width: 200,
                      render: (_: unknown, record: IProduct) => (
                        <Space onClick={(e) => e.stopPropagation()} wrap size="small">
                          {canWrite && record.status !== 'ARCHIVED' && (
                            <Button
                              size="small"
                              onClick={() => {
                                setSelectedProduct(record);
                                setDrawerMode('edit');
                                setDrawerOpen(true);
                              }}
                              aria-label={`Edit ${record.title}`}
                            >
                              Edit
                            </Button>
                          )}
                          {canPublish &&
                            record.status !== 'ACTIVE' &&
                            record.status !== 'ARCHIVED' && (
                              <Button
                                size="small"
                                type="primary"
                                onClick={() => {
                                  setSelectedProduct(record);
                                  setLifecycleAction('publish');
                                  setLifecycleModalOpen(true);
                                }}
                                aria-label={`Publish ${record.title}`}
                              >
                                Publish
                              </Button>
                            )}
                          {canWrite && record.status === 'ACTIVE' && (
                            <Button
                              size="small"
                              onClick={() => {
                                setSelectedProduct(record);
                                setLifecycleAction('deactivate');
                                setLifecycleModalOpen(true);
                              }}
                              aria-label={`Deactivate ${record.title}`}
                            >
                              Deactivate
                            </Button>
                          )}
                          {canWrite && record.status !== 'ARCHIVED' && (
                            <Button
                              size="small"
                              danger
                              onClick={() => {
                                setSelectedProduct(record);
                                setLifecycleAction('archive');
                                setLifecycleModalOpen(true);
                              }}
                              aria-label={`Archive ${record.title}`}
                            >
                              Archive
                            </Button>
                          )}
                          {canWrite && record.status === 'DRAFT' && record.publishedAt === null && (
                            <Button
                              size="small"
                              danger
                              onClick={() => {
                                setSelectedProduct(record);
                                setLifecycleAction('delete');
                                setLifecycleModalOpen(true);
                              }}
                              aria-label={`Delete draft ${record.title}`}
                            >
                              Delete
                            </Button>
                          )}
                        </Space>
                      ),
                    },
                  ]
                : []),
            ]}
          />
        )}
        {!loading && !error && totalPages > 1 && (
          <Typography.Text type="secondary">
            Page {page} of {totalPages}
          </Typography.Text>
        )}
        {!loading && !error && (
          <Button type="text" icon={<ReloadOutlined />} onClick={() => setAttempt((n) => n + 1)}>
            Refresh
          </Button>
        )}
      </Card>

      <ProductFormDrawer
        open={drawerOpen}
        mode={drawerMode}
        product={selectedProduct}
        onClose={() => {
          setDrawerOpen(false);
          setSelectedProduct(null);
        }}
        onSuccess={() => {
          setAttempt((n) => n + 1);
        }}
      />

      <ProductLifecycleModal
        open={lifecycleModalOpen}
        action={lifecycleAction}
        product={selectedProduct}
        onClose={() => {
          setLifecycleModalOpen(false);
          setSelectedProduct(null);
        }}
        onSuccess={() => {
          setAttempt((n) => n + 1);
        }}
      />
    </div>
  );
}
