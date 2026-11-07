/**
 * Category Navigation Rail / Grid
 *
 * Renders active root categories fetched from GET /api/v1/categories.
 * Clicking a category filters the Product Listing Page (PLP).
 */

import React, { useEffect, useState } from 'react';
import type { ICategoryTreeItem } from '@thehomez/shared-types';
import { useStorefront } from '../../context/StorefrontContext.js';

export const CategoryRail: React.FC = () => {
  const { apiClient, navigateToCategory } = useStorefront();
  const [categories, setCategories] = useState<ICategoryTreeItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    const fetchCategories = async () => {
      try {
        setLoading(true);
        const data = await apiClient.getCategories();
        if (isMounted) {
          // Sort by displayOrder
          const sorted = [...data].sort((a, b) => a.displayOrder - b.displayOrder);
          setCategories(sorted);
        }
      } catch (err) {
        if (isMounted) {
          setError(err instanceof Error ? err.message : 'Failed to load categories');
        }
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    fetchCategories();
    return () => {
      isMounted = false;
    };
  }, [apiClient]);

  if (loading) {
    return (
      <div style={{ margin: '24px 0' }}>
        <h2 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '16px' }}>
          Explore Building Materials
        </h2>
        <div className="thz-cat-grid">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="thz-skeleton-card" style={{ height: '70px' }} />
          ))}
        </div>
      </div>
    );
  }

  if (error || categories.length === 0) {
    return null;
  }

  return (
    <section style={{ margin: '32px 0' }} aria-labelledby="cat-rail-title">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <h2 id="cat-rail-title" style={{ fontSize: '1.25rem', fontWeight: 600 }}>
          Explore Building Materials
        </h2>
        <span style={{ fontSize: '0.85rem', color: 'var(--thz-text-muted)' }}>
          Browse by category
        </span>
      </div>

      <div className="thz-cat-grid">
        {categories.map((cat) => (
          <button
            key={cat.id}
            type="button"
            className="thz-cat-card"
            onClick={() => navigateToCategory(cat.slug)}
            aria-label={`Browse category: ${cat.name}`}
          >
            <div className="thz-cat-card-name">{cat.name}</div>
            {cat.subcategories && cat.subcategories.length > 0 && (
              <span
                style={{
                  fontSize: '0.75rem',
                  color: 'var(--thz-text-muted)',
                  marginTop: '4px',
                  display: 'block',
                }}
              >
                {cat.subcategories.length} subcategories
              </span>
            )}
          </button>
        ))}
      </div>
    </section>
  );
};
