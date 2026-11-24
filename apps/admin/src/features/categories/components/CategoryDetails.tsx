import { Button, Card, Descriptions, Empty, Space, Typography } from 'antd';
import {
  CloseOutlined,
  DeleteOutlined,
  EditOutlined,
  ExportOutlined,
  PlusOutlined,
} from '@ant-design/icons';
import type { ICategoryDetailsResponse, ICategorySubcategoryItem } from '@thehomez/shared-types';
import { CategoryStatus } from './CategoryStatus.js';

export interface CategoryDetailsProps {
  details: ICategoryDetailsResponse | null;
  canWrite?: boolean;
  onEdit?: () => void;
  onDelete?: () => void;
  onAddSubcategory?: () => void;
  onEditChild?: (child: ICategorySubcategoryItem) => void;
  onDeleteChild?: (child: ICategorySubcategoryItem) => void;
  onClose?: () => void;
  onViewPage?: () => void;
}

export function CategoryDetails({
  details,
  canWrite = false,
  onEdit,
  onDelete,
  onAddSubcategory,
  onEditChild,
  onDeleteChild,
  onClose,
  onViewPage,
}: CategoryDetailsProps) {
  if (!details)
    return (
      <Card variant="borderless">
        <Empty description="Select a category to view its details" />
      </Card>
    );
  const { category, parent, subcategories } = details;
  const isLeaf =
    category.level === 1 ||
    (category.level === 0 && (!subcategories || subcategories.length === 0));

  return (
    <Card
      variant="borderless"
      title={
        <Space>
          <Typography.Title level={4} className="card-title">
            {category.name}
          </Typography.Title>
          <CategoryStatus isActive={category.isActive} />
        </Space>
      }
      extra={
        <Space>
          {onViewPage && (
            <Button size="small" icon={<ExportOutlined />} onClick={onViewPage}>
              Full page
            </Button>
          )}
          {canWrite && (
            <>
              {category.level === 0 && (
                <Button type="primary" icon={<PlusOutlined />} onClick={onAddSubcategory}>
                  Add subcategory
                </Button>
              )}
              <Button icon={<EditOutlined />} onClick={onEdit}>
                Edit
              </Button>
              {isLeaf && (
                <Button danger icon={<DeleteOutlined />} onClick={onDelete}>
                  Delete
                </Button>
              )}
            </>
          )}
          {onClose && (
            <Button
              type="text"
              icon={<CloseOutlined />}
              onClick={onClose}
              aria-label="Close inspector"
            />
          )}
        </Space>
      }
    >
      <Descriptions column={{ xs: 1, sm: 1, md: 2 }} size="small">
        <Descriptions.Item label="Slug">{category.slug}</Descriptions.Item>
        <Descriptions.Item label="Type">
          {category.level === 0 ? 'Parent category' : 'Child category'}
        </Descriptions.Item>
        <Descriptions.Item label="Parent">
          {category.level === 0 ? '—' : parent?.name || 'Unavailable'}
        </Descriptions.Item>
        <Descriptions.Item label="Sort order">{category.displayOrder}</Descriptions.Item>
        <Descriptions.Item label="Description" span={2}>
          {category.description || 'No description provided'}
        </Descriptions.Item>
        <Descriptions.Item label="Created">
          {new Date(category.createdAt).toLocaleString()}
        </Descriptions.Item>
        <Descriptions.Item label="Last updated">
          {new Date(category.updatedAt).toLocaleString()}
        </Descriptions.Item>
      </Descriptions>
      {category.level === 0 && (
        <section className="detail-children" aria-label="Child categories">
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 12,
            }}
          >
            <Typography.Title level={5} style={{ margin: 0 }}>
              Child categories ({subcategories?.length ?? 0})
            </Typography.Title>
            {canWrite && (
              <Button size="small" icon={<PlusOutlined />} onClick={onAddSubcategory}>
                Add subcategory
              </Button>
            )}
          </div>
          {subcategories?.length ? (
            <ul>
              {subcategories.map((child) => (
                <li
                  key={child.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '4px 0',
                  }}
                >
                  <Space>
                    {child.name}
                    <CategoryStatus isActive={child.isActive} />
                  </Space>
                  {canWrite && (
                    <Space size={4}>
                      <Button
                        size="small"
                        type="link"
                        icon={<EditOutlined />}
                        onClick={() => onEditChild?.(child)}
                      >
                        Edit
                      </Button>
                      <Button
                        size="small"
                        type="link"
                        danger
                        icon={<DeleteOutlined />}
                        onClick={() => onDeleteChild?.(child)}
                      >
                        Delete
                      </Button>
                    </Space>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <Typography.Text type="secondary">No child categories.</Typography.Text>
          )}
        </section>
      )}
    </Card>
  );
}
