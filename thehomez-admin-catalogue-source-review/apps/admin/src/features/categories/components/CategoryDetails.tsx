import { Card, Descriptions, Empty, Space, Typography } from 'antd';
import type { ICategoryDetailsResponse } from '@thehomez/shared-types';
import { CategoryStatus } from './CategoryStatus.js';

export function CategoryDetails({ details }: { details: ICategoryDetailsResponse | null }) {
  if (!details)
    return (
      <Card variant="borderless">
        <Empty description="Select a category to view its details" />
      </Card>
    );
  const { category, parent, subcategories } = details;
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
          <Typography.Title level={5}>
            Child categories ({subcategories?.length ?? 0})
          </Typography.Title>
          {subcategories?.length ? (
            <ul>
              {subcategories.map((child) => (
                <li key={child.id}>
                  <Space>
                    {child.name}
                    <CategoryStatus isActive={child.isActive} />
                  </Space>
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
