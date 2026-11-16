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
import { ApiError } from '../../../services/api-client.js';
import { useAuth } from '../../../providers/AuthProvider.js';
import { categoryClient } from '../api/category-client.js';
import { CategoryBrowserPage } from './CategoryBrowserPage.js';
import { CategoryDetailPage } from './CategoryDetailPage.js';

vi.mock('../../../providers/AuthProvider.js', () => ({ useAuth: vi.fn() }));
vi.mock('../api/category-client.js', () => ({
  categoryClient: {
    getTree: vi.fn(),
    getDetails: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  slugify: (text: string) =>
    text
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, ''),
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

describe('category browser pages', { timeout: 15000 }, () => {
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

  it('ensures read-only user cannot see management actions', async () => {
    vi.mocked(useAuth).mockReturnValue(authState(staff));
    vi.mocked(categoryClient.getTree).mockResolvedValue({ categories });
    renderRoutes();
    expect(await screen.findByText('Materials')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /add category/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /add subcategory/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /edit/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /delete/i })).not.toBeInTheDocument();
  });

  it('ensures CATALOG_WRITE user sees management actions and respects leaf deletion rules', async () => {
    const writeStaff: IAuthUser = {
      ...staff,
      permissions: [PermissionCode.CATALOG_READ, PermissionCode.CATALOG_WRITE],
    };
    const mixedCategories: ICategoryTreeItem[] = [
      ...categories,
      {
        id: 'root-2',
        slug: 'tools',
        name: 'Tools',
        parentId: null,
        level: 0,
        displayOrder: 2,
        isActive: true,
        subcategories: [],
      },
    ];
    vi.mocked(useAuth).mockReturnValue(authState(writeStaff));
    vi.mocked(categoryClient.getTree).mockResolvedValue({ categories: mixedCategories });
    const { container } = renderRoutes();

    expect(await screen.findByText('Materials')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /add category/i })).toBeInTheDocument();

    // Both root categories are eligible to have subcategories added
    const addSubBtns = screen.getAllByRole('button', { name: /add subcategory/i });
    expect(addSubBtns.length).toBe(2);

    // 'Tools' has no children -> leaf category, so delete is available
    expect(screen.getByText('Tools')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /delete/i })).toBeInTheDocument();

    // Expand tree to verify child 'Cement' has Edit and Delete
    const switcher = container.querySelector('.ant-tree-switcher');
    expect(switcher).not.toBeNull();
    fireEvent.click(switcher!);
    expect(await screen.findByText('Cement')).toBeInTheDocument();
  });

  it('allows CATALOG_WRITE user to create a root category', async () => {
    const writeStaff: IAuthUser = {
      ...staff,
      permissions: [PermissionCode.CATALOG_READ, PermissionCode.CATALOG_WRITE],
    };
    vi.mocked(useAuth).mockReturnValue(authState(writeStaff));
    vi.mocked(categoryClient.getTree).mockResolvedValue({ categories });
    vi.mocked(categoryClient.create).mockResolvedValue({
      category: {
        id: 'root-3',
        slug: 'electricals',
        name: 'Electricals',
        parentId: null,
        level: 0,
        displayOrder: 0,
        isActive: true,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    });

    renderRoutes();
    expect(await screen.findByText('Materials')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /add category/i }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Root Category (Level 0)')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/category name/i), {
      target: { value: 'Electricals' },
    });
    fireEvent.click(screen.getByRole('button', { name: /create category/i }));

    await waitFor(() => {
      expect(categoryClient.create).toHaveBeenCalledWith({
        name: 'Electricals',
        slug: 'electricals',
        parentId: null,
        displayOrder: 0,
        isActive: true,
        description: undefined,
      });
    });

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(categoryClient.getTree).toHaveBeenCalledTimes(2);
  });

  it('allows CATALOG_WRITE user to create a subcategory under an existing parent', async () => {
    const writeStaff: IAuthUser = {
      ...staff,
      permissions: [PermissionCode.CATALOG_READ, PermissionCode.CATALOG_WRITE],
    };
    vi.mocked(useAuth).mockReturnValue(authState(writeStaff));
    vi.mocked(categoryClient.getTree).mockResolvedValue({ categories });
    vi.mocked(categoryClient.create).mockResolvedValue({
      category: {
        id: 'child-2',
        slug: 'sand',
        name: 'Sand',
        parentId: 'root-1',
        level: 1,
        displayOrder: 0,
        isActive: true,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    });

    renderRoutes();
    expect(await screen.findByText('Materials')).toBeInTheDocument();

    const addSubBtns = screen.getAllByRole('button', { name: /add subcategory/i });
    fireEvent.click(addSubBtns[0]!);

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Subcategory (Level 1)')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/category name/i), {
      target: { value: 'Sand' },
    });
    fireEvent.click(screen.getByRole('button', { name: /create category/i }));

    await waitFor(() => {
      expect(categoryClient.create).toHaveBeenCalledWith({
        name: 'Sand',
        slug: 'sand',
        parentId: 'root-1',
        displayOrder: 0,
        isActive: true,
        description: undefined,
      });
    });
  });

  it('displays validation feedback on invalid form submission and handles backend conflict', async () => {
    const writeStaff: IAuthUser = {
      ...staff,
      permissions: [PermissionCode.CATALOG_READ, PermissionCode.CATALOG_WRITE],
    };
    vi.mocked(useAuth).mockReturnValue(authState(writeStaff));
    vi.mocked(categoryClient.getTree).mockResolvedValue({ categories });
    vi.mocked(categoryClient.create).mockRejectedValueOnce(
      new ApiError('A category with this URL slug already exists', 409, 'CATEGORY_SLUG_EXISTS'),
    );

    renderRoutes();
    expect(await screen.findByText('Materials')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /add category/i }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();

    // Submitting without name triggers validation
    fireEvent.click(screen.getByRole('button', { name: /create category/i }));
    expect(await screen.findByText('Please enter category name')).toBeInTheDocument();
    expect(categoryClient.create).not.toHaveBeenCalled();

    // Entering name and submitting when backend rejects with 409
    fireEvent.change(screen.getByLabelText(/category name/i), {
      target: { value: 'Duplicate Slug' },
    });
    fireEvent.click(screen.getByRole('button', { name: /create category/i }));

    expect(
      await screen.findByText(/a category with this url slug already exists/i),
    ).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('allows editing category metadata and changing active status', async () => {
    const writeStaff: IAuthUser = {
      ...staff,
      permissions: [PermissionCode.CATALOG_READ, PermissionCode.CATALOG_WRITE],
    };
    const leafCategories: ICategoryTreeItem[] = [
      {
        id: 'root-tools',
        slug: 'tools',
        name: 'Tools',
        parentId: null,
        level: 0,
        displayOrder: 1,
        isActive: true,
        subcategories: [],
      },
    ];
    vi.mocked(useAuth).mockReturnValue(authState(writeStaff));
    vi.mocked(categoryClient.getTree).mockResolvedValue({ categories: leafCategories });
    vi.mocked(categoryClient.update).mockResolvedValue({
      category: {
        id: 'root-tools',
        slug: 'power-tools',
        name: 'Power Tools',
        parentId: null,
        level: 0,
        displayOrder: 5,
        isActive: false,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-02T00:00:00.000Z',
      },
    });

    renderRoutes();
    expect(await screen.findByText('Tools')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /edit/i }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Edit "Tools"')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/category name/i), {
      target: { value: 'Power Tools' },
    });
    fireEvent.click(screen.getByRole('switch', { name: /active status/i }));

    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => {
      expect(categoryClient.update).toHaveBeenCalledWith(
        'root-tools',
        expect.objectContaining({
          name: 'Power Tools',
          isActive: false,
        }),
      );
    });
  });

  it('supports permanent leaf deletion and shows backend rejection when referenced', async () => {
    const writeStaff: IAuthUser = {
      ...staff,
      permissions: [PermissionCode.CATALOG_READ, PermissionCode.CATALOG_WRITE],
    };
    const leafCategories: ICategoryTreeItem[] = [
      {
        id: 'root-tools',
        slug: 'tools',
        name: 'Tools',
        parentId: null,
        level: 0,
        displayOrder: 1,
        isActive: true,
        subcategories: [],
      },
    ];
    vi.mocked(useAuth).mockReturnValue(authState(writeStaff));
    vi.mocked(categoryClient.getTree).mockResolvedValue({ categories: leafCategories });
    vi.mocked(categoryClient.delete)
      .mockRejectedValueOnce(
        new ApiError(
          'Cannot delete category: products in the catalogue are currently referencing it',
          400,
          'CATEGORY_HAS_PRODUCTS',
        ),
      )
      .mockResolvedValueOnce({ message: 'Category deleted' });

    renderRoutes();
    expect(await screen.findByText('Tools')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /delete/i }));
    expect(await screen.findByText('Delete "Tools"?')).toBeInTheDocument();
    expect(screen.getByText(/this action is permanent and cannot be undone/i)).toBeInTheDocument();

    // First attempt rejects due to CATEGORY_HAS_PRODUCTS
    const deleteBtn = screen.getByRole('button', { name: /delete category/i });
    fireEvent.click(deleteBtn);

    expect(
      await screen.findByText(/products in the catalogue are currently referencing it/i),
    ).toBeInTheDocument();

    // Second attempt succeeds
    fireEvent.click(deleteBtn);
    await waitFor(() => {
      expect(categoryClient.delete).toHaveBeenCalledWith('root-tools');
    });
    await waitFor(() => {
      expect(screen.queryByText('Delete "Tools"?')).not.toBeInTheDocument();
    });
  });

  it('supports editing and deleting from CategoryDetailPage for CATALOG_WRITE staff', async () => {
    const writeStaff: IAuthUser = {
      ...staff,
      permissions: [PermissionCode.CATALOG_READ, PermissionCode.CATALOG_WRITE],
    };
    vi.mocked(useAuth).mockReturnValue(authState(writeStaff));
    vi.mocked(categoryClient.getDetails).mockResolvedValue(details);
    vi.mocked(categoryClient.delete).mockResolvedValue({ message: 'Deleted' });

    renderRoutes('/catalogue/categories/cement');
    expect(await screen.findByText('Cement')).toBeInTheDocument();

    // Cement is level 1 (leaf), so Edit and Delete are present
    expect(screen.getByRole('button', { name: /edit/i })).toBeInTheDocument();
    const deleteBtn = screen.getByRole('button', { name: /delete/i });
    expect(deleteBtn).toBeInTheDocument();

    fireEvent.click(deleteBtn);
    expect(await screen.findByText('Delete "Cement"?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /delete category/i }));

    await waitFor(() => {
      expect(categoryClient.delete).toHaveBeenCalledWith('child-1');
    });
  });
});
