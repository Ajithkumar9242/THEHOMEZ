import type { ICategoryTreeItem, IUnit } from '@thehomez/shared-types';
import { apiRequest } from '../../../services/api-client.js';

export async function getCategories(
  signal?: AbortSignal,
): Promise<{ tree: ICategoryTreeItem[]; labels: Map<string, string> }> {
  const result = await apiRequest<{ categories: ICategoryTreeItem[] }>(
    '/categories?includeInactive=true',
    { method: 'GET', signal },
  );
  return {
    tree: result.categories,
    labels: new Map(
      result.categories.flatMap((root) =>
        [root, ...root.subcategories].map((category) => [category.id, category.name] as const),
      ),
    ),
  };
}

export async function getUnitLabels(signal?: AbortSignal): Promise<Map<string, string>> {
  const units = await apiRequest<IUnit[]>('/units?activeOnly=false', { method: 'GET', signal });
  return new Map(units.map((unit) => [unit.code, `${unit.name} (${unit.symbol})`]));
}
