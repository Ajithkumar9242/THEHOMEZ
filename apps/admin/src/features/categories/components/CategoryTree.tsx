import { Button, Empty, Space, Tree, Typography } from 'antd';
import { DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons';
import type { DataNode } from 'antd/es/tree';
import type { ICategorySubcategoryItem, ICategoryTreeItem } from '@thehomez/shared-types';
import { CategoryStatus } from './CategoryStatus.js';

function matches(
  query: string,
  category: { name: string; slug: string; description?: string },
): boolean {
  const value = query.trim().toLocaleLowerCase();
  return (
    !value ||
    `${category.name} ${category.slug} ${category.description || ''}`
      .toLocaleLowerCase()
      .includes(value)
  );
}

function childNode(
  category: ICategorySubcategoryItem,
  options?: {
    canWrite?: boolean;
    onEdit?: (cat: ICategorySubcategoryItem) => void;
    onDelete?: (cat: ICategorySubcategoryItem) => void;
  },
): DataNode {
  return {
    key: category.id,
    title: (
      <span className="category-tree-node-wrapper">
        <span className="category-tree-title">
          <Typography.Text>{category.name}</Typography.Text>
          <CategoryStatus isActive={category.isActive} />
        </span>
        {options?.canWrite && (
          <Space size={2} className="category-tree-actions" onClick={(e) => e.stopPropagation()}>
            <Button
              size="small"
              type="text"
              icon={<EditOutlined />}
              onClick={() => options.onEdit?.(category)}
            >
              Edit
            </Button>
            <Button
              size="small"
              type="text"
              danger
              icon={<DeleteOutlined />}
              onClick={() => options.onDelete?.(category)}
            >
              Delete
            </Button>
          </Space>
        )}
      </span>
    ),
    isLeaf: true,
    selectable: true,
  };
}

export function buildCategoryTree(
  categories: ICategoryTreeItem[],
  query = '',
  options?: {
    canWrite?: boolean;
    onAddSubcategory?: (root: ICategoryTreeItem) => void;
    onEdit?: (cat: ICategoryTreeItem | ICategorySubcategoryItem) => void;
    onDelete?: (cat: ICategoryTreeItem | ICategorySubcategoryItem) => void;
  },
): DataNode[] {
  return categories.flatMap((category) => {
    const children = category.subcategories
      .filter((child) => matches(query, child))
      .map((child) => childNode(child, options));
    if (!matches(query, category) && children.length === 0) return [];
    const isLeaf = category.subcategories.length === 0;
    return [
      {
        key: category.id,
        title: (
          <span className="category-tree-node-wrapper">
            <span className="category-tree-title">
              <Typography.Text strong>{category.name}</Typography.Text>
              <CategoryStatus isActive={category.isActive} />
            </span>
            {options?.canWrite && (
              <Space
                size={2}
                className="category-tree-actions"
                onClick={(e) => e.stopPropagation()}
              >
                <Button
                  size="small"
                  type="text"
                  icon={<PlusOutlined />}
                  onClick={() => options.onAddSubcategory?.(category)}
                >
                  Add subcategory
                </Button>
                <Button
                  size="small"
                  type="text"
                  icon={<EditOutlined />}
                  onClick={() => options.onEdit?.(category)}
                >
                  Edit
                </Button>
                {isLeaf && (
                  <Button
                    size="small"
                    type="text"
                    danger
                    icon={<DeleteOutlined />}
                    onClick={() => options.onDelete?.(category)}
                  >
                    Delete
                  </Button>
                )}
              </Space>
            )}
          </span>
        ),
        children,
        selectable: true,
      },
    ];
  });
}

export interface CategoryTreeProps {
  categories: ICategoryTreeItem[];
  search: string;
  selectedId?: string;
  onSelect: (categoryId: string) => void;
  canWrite?: boolean;
  onAddSubcategory?: (root: ICategoryTreeItem) => void;
  onEdit?: (cat: ICategoryTreeItem | ICategorySubcategoryItem) => void;
  onDelete?: (cat: ICategoryTreeItem | ICategorySubcategoryItem) => void;
}

export function CategoryTree({
  categories,
  search,
  selectedId,
  onSelect,
  canWrite = false,
  onAddSubcategory,
  onEdit,
  onDelete,
}: CategoryTreeProps) {
  const treeData = buildCategoryTree(categories, search, {
    canWrite,
    onAddSubcategory,
    onEdit,
    onDelete,
  });
  if (treeData.length === 0)
    return <Empty description={search ? 'No matching categories' : 'No categories found'} />;
  return (
    <Tree
      aria-label="Category hierarchy"
      showLine
      blockNode
      selectedKeys={selectedId ? [selectedId] : []}
      treeData={treeData}
      onSelect={(keys) => {
        if (keys[0]) onSelect(String(keys[0]));
      }}
    />
  );
}
