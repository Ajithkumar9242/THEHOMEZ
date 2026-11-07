/**
 * Category Navigation Rail / Grid
 *
 * Renders active root categories fetched from GET /api/v1/categories.
 * Clicking a category filters the Product Listing Page (PLP).
 */

import React, { useEffect, useState } from 'react';
import type { ICategoryTreeItem } from '@thehomez/shared-types';
import { useStorefront } from '../../context/StorefrontContext.js';

const getCategoryIcon = (slug: string) => {
  switch (slug) {
    case 'structural-steel':
      return '🔩';
    case 'cement-concrete':
      return '🧱';
    case 'plumbing-sanitary':
    case 'plumbing':
      return '🚰';
    case 'electrical':
    case 'electrical-lighting':
      return '⚡';
    default:
      return '🏗️';
  }
};

const getCategorySubchips = (cat: ICategoryTreeItem) => {
  if (cat.subcategories && cat.subcategories.length > 0) {
    return cat.subcategories.slice(0, 3).map((s) => s.name);
  }
  switch (cat.slug) {
    case 'structural-steel':
      return ['Fe 550D Rebars', 'Binding Wire', 'MS Angles'];
    case 'cement-concrete':
      return ['OPC 53 Grade', 'PPC', 'Ready-Mix'];
    case 'masonry-blocks':
      return ['AAC Blocks', 'Solid Clay Bricks', 'Fly Ash'];
    case 'plumbing':
    case 'plumbing-sanitary':
      return ['CPVC Pipes', 'SWR Fittings', 'Overhead Tanks'];
    case 'electrical':
    case 'electrical-lighting':
      return ['FR Copper Wires', 'Conduits', 'MCBs & DBs'];
    default:
      return ['Certified Batches', 'Wholesale Rates'];
  }
};

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
      <div style={{ margin: '32px 0' }}>
        <h2 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '16px' }}>
          Explore Building Materials
        </h2>
        <div className="thz-cat-grid">
          {[1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="thz-skeleton-card"
              style={{ height: '140px', borderRadius: '8px' }}
            />
          ))}
        </div>
      </div>
    );
  }

  if (error || categories.length === 0) {
    return null;
  }

  return (
    <section style={{ margin: '36px 0' }} aria-labelledby="cat-rail-title">
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          marginBottom: '16px',
        }}
      >
        <div>
          <span className="thz-section-eyebrow">Trade Taxonomy</span>
          <h2 id="cat-rail-title" className="thz-section-title" style={{ fontSize: '1.35rem' }}>
            Explore Building Materials
          </h2>
        </div>
        <span style={{ fontSize: '0.85rem', color: 'var(--thz-text-muted)' }}>
          Direct hub dispatch by division
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
            <div className="thz-cat-card-top">
              <div className="thz-cat-icon-box" aria-hidden="true">
                {getCategoryIcon(cat.slug)}
              </div>
              <span className="thz-cat-count-pill">
                {cat.subcategories && cat.subcategories.length > 0
                  ? `${cat.subcategories.length} Types`
                  : 'Certified'}
              </span>
            </div>
            <div>
              <div className="thz-cat-card-name">{cat.name}</div>
              <div className="thz-cat-sub-chips">
                {getCategorySubchips(cat).map((sub, i) => (
                  <span key={i} className="thz-cat-sub-chip">
                    {sub}
                  </span>
                ))}
              </div>
            </div>
            <div className="thz-cat-card-footer">
              <span>Browse Category</span>
              <span className="thz-cat-arrow" aria-hidden="true">
                →
              </span>
            </div>
          </button>
        ))}
      </div>
    </section>
  );
};
