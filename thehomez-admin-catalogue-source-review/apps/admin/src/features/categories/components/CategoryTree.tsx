import { Empty, Tree, Typography } from 'antd';
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

function childNode(category: ICategorySubcategoryItem): DataNode {
  return {
    key: category.id,
    title: (
      <span className="category-tree-title">
        <Typography.Text>{category.name}</Typography.Text>
        <CategoryStatus isActive={category.isActive} />
      </span>
    ),
    isLeaf: true,
    selectable: true,
  };
}

export function buildCategoryTree(categories: ICategoryTreeItem[], query = ''): DataNode[] {
  return categories.flatMap((category) => {
    const children = category.subcategories.filter((child) => matches(query, child)).map(childNode);
    if (!matches(query, category) && children.length === 0) return [];
    return [
      {
        key: category.id,
        title: (
          <span className="category-tree-title">
            <Typography.Text strong>{category.name}</Typography.Text>
            <CategoryStatus isActive={category.isActive} />
          </span>
        ),
        children,
        selectable: true,
      },
    ];
  });
}

export function CategoryTree({
  categories,
  search,
  selectedId,
  onSelect,
}: {
  categories: ICategoryTreeItem[];
  search: string;
  selectedId?: string;
  onSelect: (categoryId: string) => void;
}) {
  const treeData = buildCategoryTree(categories, search);
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
