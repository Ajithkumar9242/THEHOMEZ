import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import {
  PermissionCode,
  UserStatus,
  UserType,
  type IAuthUser,
  type ICategoryDetailsResponse,
  type ICategoryTreeItem,
} from '@thehomez/shared-types';
import { useAuth } from '../../../providers/AuthProvider.js';
import { categoryClient } from '../api/category-client.js';
import { CategoryBrowserPage } from './CategoryBrowserPage.js';
import { CategoryDetailPage } from './CategoryDetailPage.js';

vi.mock('../../../providers/AuthProvider.js', () => ({ useAuth: vi.fn() }));
vi.mock('../api/category-client.js', () => ({
  categoryClient: { getTree: vi.fn(), getDetails: vi.fn() },
}));

const staff: IAuthUser = {
  id: 'staff-1',
  phone: '+910000000000',
  userType: UserType.STAFF,
  status: UserStatus.ACTIVE,
  roles: [],
  permissions: [PermissionCode.CATALOG_READ],
  createdAt: '2026-01-01T00:00:00.000Z',
};

const categories: ICategoryTreeItem[] = [
  {
    id: 'root-1',
    slug: 'materials',
    name: 'Materials',
    parentId: null,
    level: 0,
    displayOrder: 1,
    isActive: true,
    subcategories: [
      {
        id: 'child-1',
        slug: 'cement',
        name: 'Cement',
        parentId: 'root-1',
        level: 1,
        displayOrder: 1,
        isActive: false,
      },
    ],
  },
];

const details: ICategoryDetailsResponse = {
  category: {
    id: 'child-1',
    slug: 'cement',
    name: 'Cement',
    parentId: 'root-1',
    level: 1,
    displayOrder: 1,
    isActive: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
  },
  parent: {
    id: 'root-1',
    slug: 'materials',
    name: 'Materials',
    parentId: null,
    level: 0,
    displayOrder: 1,
    isActive: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
  },
  subcategories: [],
};

function authState(user: IAuthUser | null) {
  return {
    user,
    status: 'signed-in' as const,
    signIn: vi.fn(),
    requestOtp: vi.fn(),
    signOut: vi.fn(),
  };
}

function renderRoutes(path = '/catalogue/categories') {
  return render(
    <MemoryRouter
      initialEntries={[path]}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <Routes>
        <Route path="/catalogue/categories" element={<CategoryBrowserPage />} />
        <Route path="/catalogue/categories/:slug" element={<CategoryDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(() => vi.clearAllMocks());

describe('category browser pages', () => {
  it('shows loading then persisted hierarchy with active state and expandable branches', async () => {
    let resolveTree!: (result: { categories: ICategoryTreeItem[] }) => void;
    vi.mocked(useAuth).mockReturnValue(authState(staff));
    vi.mocked(categoryClient.getTree).mockReturnValue(
      new Promise((resolve) => {
        resolveTree = resolve;
      }),
    );
    const { container } = renderRoutes();
    expect(container.querySelector('.ant-skeleton')).toBeInTheDocument();
    await act(async () => {
      resolveTree({ categories });
    });
    expect(await screen.findByText('Materials')).toBeInTheDocument();
    expect(screen.queryByText('Cement')).not.toBeInTheDocument();
    const switcher = container.querySelector('.ant-tree-switcher');
    expect(switcher).not.toBeNull();
    fireEvent.click(switcher!);
    expect(await screen.findByText('Cement')).toBeInTheDocument();
    expect(screen.getByText('Inactive')).toBeInTheDocument();
    fireEvent.click(switcher!);
    await waitFor(() => expect(screen.queryByText('Cement')).not.toBeInTheDocument());
  });

  it('does not call the API and explains missing CATALOG_READ', () => {
    vi.mocked(useAuth).mockReturnValue(authState({ ...staff, permissions: [] }));
    renderRoutes();
    expect(screen.getByText('Permission required')).toBeInTheDocument();
    expect(categoryClient.getTree).not.toHaveBeenCalled();
  });

  it('shows an explicit empty state for an empty backend response', async () => {
    vi.mocked(useAuth).mockReturnValue(authState(staff));
    vi.mocked(categoryClient.getTree).mockResolvedValue({ categories: [] });
    renderRoutes();
    expect(await screen.findByText('No categories found')).toBeInTheDocument();
  });

  it('requests inactive records only when the authorized user opts in', async () => {
    vi.mocked(useAuth).mockReturnValue(authState(staff));
    vi.mocked(categoryClient.getTree).mockResolvedValue({ categories });
    renderRoutes();
    await screen.findByText('Materials');
    expect(categoryClient.getTree).toHaveBeenCalledWith(
      expect.objectContaining({ includeInactive: false, signal: expect.any(AbortSignal) }),
    );
    fireEvent.click(screen.getByRole('checkbox', { name: 'Include inactive' }));
    await waitFor(() =>
      expect(categoryClient.getTree).toHaveBeenLastCalledWith(
        expect.objectContaining({ includeInactive: true, signal: expect.any(AbortSignal) }),
      ),
    );
  });

  it('loads and displays category details and returned parent/status fields', async () => {
    vi.mocked(categoryClient.getDetails).mockResolvedValue(details);
    renderRoutes('/catalogue/categories/cement');
    expect(await screen.findByText('Cement')).toBeInTheDocument();
    expect(screen.getByText('Materials')).toBeInTheDocument();
    expect(screen.getByText('Inactive')).toBeInTheDocument();
    expect(screen.getByText('cement')).toBeInTheDocument();
    expect(categoryClient.getDetails).toHaveBeenCalledWith(
      'cement',
      expect.objectContaining({ includeInactive: false, signal: expect.any(AbortSignal) }),
    );
  });

  it('shows retry after a transient failure and exposes no mutation controls', async () => {
    vi.mocked(useAuth).mockReturnValue(authState(staff));
    vi.mocked(categoryClient.getTree)
      .mockRejectedValueOnce(new Error('Temporary failure'))
      .mockResolvedValueOnce({ categories });
    renderRoutes();
    expect(await screen.findByText('Categories could not be loaded')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(await screen.findByText('Materials')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /create|edit|delete|activate|deactivate/i }),
    ).not.toBeInTheDocument();
  });
});
