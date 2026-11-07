import { Types } from 'mongoose';
import {
  type ICategory,
  type ICategoryTreeItem,
  type ICategorySubcategoryItem,
  type ICategoryDetailsResponse,
  type ICreateCategoryDto,
  type IUpdateCategoryDto,
} from '@thehomez/shared-types';
import { CategoryModel, type ICategoryDocument } from '../../models/category.model.js';
import { ProductModel } from '../../models/product.model.js';
import { withTransaction } from '../../database/transaction.js';
import { logger } from '../../logger/logger.js';

export class CategoryError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number = 400,
  ) {
    super(message);
    this.name = 'CategoryError';
  }
}

export class CategoryService {
  /**
   * Formats a Mongoose category document into a standard ICategory contract.
   */
  public static toCategoryDto(doc: ICategoryDocument): ICategory {
    return {
      id: doc._id.toString(),
      slug: doc.slug,
      name: doc.name,
      description: doc.description,
      parentId: doc.parentId ? doc.parentId.toString() : null,
      level: doc.level,
      displayOrder: doc.displayOrder,
      isActive: doc.isActive,
      iconUrl: doc.iconUrl,
      imageUrl: doc.imageUrl,
      createdAt: doc.createdAt.toISOString(),
      updatedAt: doc.updatedAt.toISOString(),
    };
  }

  /**
   * Formats a Mongoose category document into a subcategory item.
   */
  public static toSubcategoryItem(doc: ICategoryDocument): ICategorySubcategoryItem {
    return {
      id: doc._id.toString(),
      slug: doc.slug,
      name: doc.name,
      description: doc.description,
      parentId: doc.parentId ? doc.parentId.toString() : '',
      level: 1,
      displayOrder: doc.displayOrder,
      isActive: doc.isActive,
      iconUrl: doc.iconUrl,
      imageUrl: doc.imageUrl,
    };
  }

  /**
   * Retrieves the full two-tier hierarchical category tree.
   *
   * AC-TAX-03: Sorts categories and subcategories strictly by `displayOrder: 1, name: 1`.
   * AC-TAX-04: When includeInactive is false (public view), inactive root categories
   * are omitted, and subcategories under inactive parents or with isActive === false
   * are strictly excluded.
   */
  public async getCategoryTree(includeInactive = false): Promise<ICategoryTreeItem[]> {
    // 1. Fetch root categories (level 0)
    const rootFilter: Record<string, unknown> = { level: 0 };
    if (!includeInactive) {
      rootFilter.isActive = true;
    }

    const roots = await CategoryModel.find(rootFilter)
      .sort({ displayOrder: 1, name: 1 })
      .lean<ICategoryDocument[]>();

    if (roots.length === 0) {
      return [];
    }

    const rootIds = roots.map((r) => r._id);

    // 2. Fetch child subcategories (level 1) belonging to the retrieved roots
    const childFilter: Record<string, unknown> = {
      level: 1,
      parentId: { $in: rootIds },
    };
    if (!includeInactive) {
      childFilter.isActive = true;
    }

    const children = await CategoryModel.find(childFilter)
      .sort({ displayOrder: 1, name: 1 })
      .lean<ICategoryDocument[]>();

    // 3. Group subcategories by parentId
    const childrenByParent = new Map<string, ICategorySubcategoryItem[]>();
    for (const child of children) {
      if (!child.parentId) continue;
      const pId = child.parentId.toString();
      if (!childrenByParent.has(pId)) {
        childrenByParent.set(pId, []);
      }
      childrenByParent.get(pId)!.push({
        id: child._id.toString(),
        slug: child.slug,
        name: child.name,
        description: child.description,
        parentId: pId,
        level: 1,
        displayOrder: child.displayOrder,
        isActive: child.isActive,
        iconUrl: child.iconUrl,
        imageUrl: child.imageUrl,
      });
    }

    // 4. Construct tree
    return roots.map((root) => {
      const rootId = root._id.toString();
      return {
        id: rootId,
        slug: root.slug,
        name: root.name,
        description: root.description,
        parentId: null,
        level: 0,
        displayOrder: root.displayOrder,
        isActive: root.isActive,
        iconUrl: root.iconUrl,
        imageUrl: root.imageUrl,
        subcategories: childrenByParent.get(rootId) ?? [],
      };
    });
  }

  /**
   * Retrieves single category details by slug.
   *
   * AC-TAX-01: Case-insensitive slug query using collation strength 2.
   * AC-TAX-04: If public lookup (!includeInactive) and category or its parent is inactive,
   * returns 404 CATEGORY_NOT_FOUND.
   */
  public async getCategoryBySlug(
    slug: string,
    includeInactive = false,
  ): Promise<ICategoryDetailsResponse> {
    const normalizedSlug = slug.trim().toLowerCase();
    const category = await CategoryModel.findOne({ slug: normalizedSlug }).collation({
      locale: 'en',
      strength: 2,
    });

    if (!category) {
      throw new CategoryError(`Category with slug "${slug}" not found`, 'CATEGORY_NOT_FOUND', 404);
    }

    if (!includeInactive && !category.isActive) {
      throw new CategoryError(`Category with slug "${slug}" not found`, 'CATEGORY_NOT_FOUND', 404);
    }

    const categoryDto = CategoryService.toCategoryDto(category);

    if (category.level === 0) {
      // Fetch subcategories
      const subFilter: Record<string, unknown> = { parentId: category._id };
      if (!includeInactive) {
        subFilter.isActive = true;
      }

      const subcategories = await CategoryModel.find(subFilter)
        .sort({ displayOrder: 1, name: 1 })
        .lean<ICategoryDocument[]>();

      return {
        category: categoryDto,
        subcategories: subcategories.map((s) => ({
          id: s._id.toString(),
          slug: s.slug,
          name: s.name,
          description: s.description,
          parentId: category._id.toString(),
          level: 1,
          displayOrder: s.displayOrder,
          isActive: s.isActive,
          iconUrl: s.iconUrl,
          imageUrl: s.imageUrl,
        })),
        parent: null,
      };
    }

    // Level 1 Subcategory
    let parentDto: ICategory | null = null;
    if (category.parentId) {
      const parent = await CategoryModel.findById(category.parentId);
      if (parent) {
        if (!includeInactive && !parent.isActive) {
          // AC-TAX-04: Subcategory is hidden if parent root category is inactive
          throw new CategoryError(
            `Category with slug "${slug}" not found`,
            'CATEGORY_NOT_FOUND',
            404,
          );
        }
        parentDto = CategoryService.toCategoryDto(parent);
      }
    }

    return {
      category: categoryDto,
      subcategories: [],
      parent: parentDto,
    };
  }

  /**
   * Retrieves a category by internal ID.
   */
  public async getCategoryById(id: string): Promise<ICategoryDocument> {
    if (!Types.ObjectId.isValid(id)) {
      throw new CategoryError('Invalid category ID format', 'INVALID_CATEGORY_ID', 400);
    }

    const category = await CategoryModel.findById(id);
    if (!category) {
      throw new CategoryError(`Category with ID "${id}" not found`, 'CATEGORY_NOT_FOUND', 404);
    }

    return category;
  }

  /**
   * Creates a new category or subcategory (Admin: CATALOG_WRITE).
   *
   * AC-TAX-01: Unique slug check with case-insensitive collation and E11000 translation.
   * AC-TAX-02: Hierarchical depth guard (subcategories can only reference level 0 roots).
   */
  public async createCategory(dto: ICreateCategoryDto): Promise<ICategoryDocument> {
    const slug = dto.slug.trim().toLowerCase();

    // 1. Slug uniqueness pre-check with case-insensitive collation
    const existingSlug = await CategoryModel.findOne({ slug }).collation({
      locale: 'en',
      strength: 2,
    });
    if (existingSlug) {
      throw new CategoryError(
        `Category with slug "${slug}" already exists`,
        'CATEGORY_SLUG_EXISTS',
        409,
      );
    }

    let parentObjectId: Types.ObjectId | null = null;
    let level: 0 | 1 = 0;

    // 2. AC-TAX-02: Validate hierarchy if parentId provided
    if (dto.parentId) {
      if (!Types.ObjectId.isValid(dto.parentId)) {
        throw new CategoryError('Invalid parentId format', 'INVALID_PARENT_ID', 400);
      }

      const parent = await CategoryModel.findById(dto.parentId);
      if (!parent) {
        throw new CategoryError('Parent category not found', 'PARENT_CATEGORY_NOT_FOUND', 404);
      }

      // Depth guard: parent must be root (level 0)
      if (parent.level !== 0 || parent.parentId) {
        throw new CategoryError(
          'Subcategories can only reference root categories (level 0). Nesting beyond level 1 is not permitted.',
          'INVALID_CATEGORY_HIERARCHY',
          400,
        );
      }

      parentObjectId = parent._id;
      level = 1;
    }

    const newCategory = new CategoryModel({
      slug,
      name: dto.name.trim(),
      description: dto.description?.trim(),
      parentId: parentObjectId,
      level,
      displayOrder: dto.displayOrder ?? 0,
      isActive: dto.isActive ?? true,
      iconUrl: dto.iconUrl?.trim(),
      imageUrl: dto.imageUrl?.trim(),
    });

    try {
      await newCategory.save();
    } catch (err: unknown) {
      const mongoErr = err as {
        code?: number;
        message?: string;
        keyPattern?: Record<string, unknown>;
      } | null;
      if (mongoErr?.code === 11000) {
        const errMsg = mongoErr.message ?? '';
        const keyPattern = mongoErr.keyPattern;
        if (
          keyPattern?.slug ||
          errMsg.includes('slug') ||
          errMsg.includes('unique_category_slug')
        ) {
          throw new CategoryError(
            `Category with slug "${slug}" already exists`,
            'CATEGORY_SLUG_EXISTS',
            409,
          );
        }
      }
      throw err;
    }

    logger.info(
      { categoryId: newCategory._id.toString(), slug: newCategory.slug, level: newCategory.level },
      'Category created successfully',
    );

    return newCategory;
  }

  /**
   * Updates an existing category (Admin: CATALOG_WRITE).
   *
   * AC-TAX-01: Validates slug uniqueness if changed.
   * AC-TAX-02: Hierarchical depth guard and circular reference prevention.
   */
  public async updateCategory(id: string, dto: IUpdateCategoryDto): Promise<ICategoryDocument> {
    if (!Types.ObjectId.isValid(id)) {
      throw new CategoryError('Invalid category ID format', 'INVALID_CATEGORY_ID', 400);
    }

    return await withTransaction(async (session) => {
      const category = await CategoryModel.findById(id).session(session);
      if (!category) {
        throw new CategoryError(`Category with ID "${id}" not found`, 'CATEGORY_NOT_FOUND', 404);
      }

      // 1. Slug change verification
      if (dto.slug) {
        const newSlug = dto.slug.trim().toLowerCase();
        if (newSlug !== category.slug) {
          const existingSlug = await CategoryModel.findOne({
            slug: newSlug,
            _id: { $ne: category._id },
          })
            .collation({ locale: 'en', strength: 2 })
            .session(session);

          if (existingSlug) {
            throw new CategoryError(
              `Category with slug "${newSlug}" already exists`,
              'CATEGORY_SLUG_EXISTS',
              409,
            );
          }
          category.slug = newSlug;
        }
      }

      // 2. Parent / Hierarchy change verification
      if (dto.parentId !== undefined) {
        if (dto.parentId === null) {
          category.parentId = null;
          category.level = 0;
        } else {
          if (!Types.ObjectId.isValid(dto.parentId)) {
            throw new CategoryError('Invalid parentId format', 'INVALID_PARENT_ID', 400);
          }

          // Circular reference prevention: cannot be own parent
          if (dto.parentId.toString() === category._id.toString()) {
            throw new CategoryError(
              'A category cannot be its own parent',
              'CATEGORY_CIRCULAR_REFERENCE',
              400,
            );
          }

          // Cannot convert root category with existing children into a subcategory
          const hasChildren = await CategoryModel.exists({ parentId: category._id }).session(
            session,
          );
          if (hasChildren) {
            throw new CategoryError(
              'Cannot convert a root category with existing subcategories into a subcategory.',
              'CATEGORY_HAS_CHILDREN',
              400,
            );
          }

          const parent = await CategoryModel.findById(dto.parentId).session(session);
          if (!parent) {
            throw new CategoryError('Parent category not found', 'PARENT_CATEGORY_NOT_FOUND', 404);
          }

          if (parent.level !== 0 || parent.parentId) {
            throw new CategoryError(
              'Subcategories can only reference root categories (level 0). Nesting beyond level 1 is not permitted.',
              'INVALID_CATEGORY_HIERARCHY',
              400,
            );
          }

          category.parentId = parent._id;
          category.level = 1;
        }
      }

      // 3. Update remaining fields
      if (dto.name !== undefined) category.name = dto.name.trim();
      if (dto.description !== undefined) category.description = dto.description.trim() || undefined;
      if (dto.displayOrder !== undefined) category.displayOrder = dto.displayOrder;
      if (dto.isActive !== undefined) {
        category.isActive = dto.isActive;
        // Increment version to force write conflict with concurrent product publications
        category.version = (category.version || 0) + 1;
      }
      if (dto.iconUrl !== undefined) category.iconUrl = dto.iconUrl.trim() || undefined;
      if (dto.imageUrl !== undefined) category.imageUrl = dto.imageUrl.trim() || undefined;

      try {
        await category.save({ session });
      } catch (err: unknown) {
        const mongoErr = err as {
          code?: number;
          message?: string;
          keyPattern?: Record<string, unknown>;
        } | null;
        if (mongoErr?.code === 11000) {
          const errMsg = mongoErr.message ?? '';
          const keyPattern = mongoErr.keyPattern;
          if (
            keyPattern?.slug ||
            errMsg.includes('slug') ||
            errMsg.includes('unique_category_slug')
          ) {
            throw new CategoryError(
              `Category with slug "${category.slug}" already exists`,
              'CATEGORY_SLUG_EXISTS',
              409,
            );
          }
        }
        throw err;
      }

      logger.info(
        { categoryId: category._id.toString(), slug: category.slug, isActive: category.isActive },
        'Category updated successfully',
      );

      return category;
    });
  }

  /**
   * Deletes a category (Admin: CATALOG_WRITE).
   *
   * REFERENTIAL INTEGRITY & LIFECYCLE POLICY:
   * 1. Hard deletion is restricted: Categories with child subcategories are blocked with HTTP 400 CATEGORY_HAS_CHILDREN.
   * 2. Categories referenced by any product record reject hard deletion with HTTP 400 CATEGORY_HAS_PRODUCTS.
   * 3. Participates in version write-intent lock within transaction to conflict with concurrent product creation/publication.
   * 4. Recommended Administrative Lifecycle: Prefer soft deprecation via deactivation (`PATCH /categories/:id` with `{ isActive: false }`).
   */
  public async deleteCategory(id: string): Promise<void> {
    if (!Types.ObjectId.isValid(id)) {
      throw new CategoryError('Invalid category ID format', 'INVALID_CATEGORY_ID', 400);
    }

    await withTransaction(async (session) => {
      // 1. Acquire category intent coordination write lock
      const category = await CategoryModel.findOneAndUpdate(
        { _id: id },
        { $inc: { version: 1 } },
        { session, new: true },
      );

      if (!category) {
        throw new CategoryError(`Category with ID "${id}" not found`, 'CATEGORY_NOT_FOUND', 404);
      }

      // 2. Hierarchical check: cannot delete if child subcategories exist
      const hasChildren = await CategoryModel.exists({ parentId: category._id }).session(session);
      if (hasChildren) {
        throw new CategoryError(
          'Cannot delete a category with existing subcategories. Reassign or delete subcategories first.',
          'CATEGORY_HAS_CHILDREN',
          400,
        );
      }

      // 3. Referential integrity check: cannot delete if products reference it
      const hasProducts = await ProductModel.exists({
        $or: [{ categoryId: category._id }, { subcategoryId: category._id }],
      }).session(session);

      if (hasProducts) {
        throw new CategoryError(
          'Cannot delete category: products are currently referencing it. Soft-deactivate the category instead.',
          'CATEGORY_HAS_PRODUCTS',
          400,
        );
      }

      // 4. Safe deletion
      await CategoryModel.deleteOne({ _id: category._id }).session(session);
      logger.info({ categoryId: id, slug: category.slug }, 'Category deleted successfully');
    });
  }

  /**
   * Idempotently seeds initial physical construction material taxonomy fixtures.
   * Trade services (Decision #3 / Phase 5) are explicitly excluded from this product taxonomy.
   */
  public async seedInitialCategories(): Promise<{ seeded: number; updated: number }> {
    const SEED_DATA: Array<{
      slug: string;
      name: string;
      description: string;
      displayOrder: number;
      subcategories: Array<{
        slug: string;
        name: string;
        description: string;
        displayOrder: number;
      }>;
    }> = [
      {
        slug: 'civil-construction',
        name: 'Civil & Construction Materials',
        description: 'Cement, sand, aggregates, and foundational building blocks',
        displayOrder: 1,
        subcategories: [
          {
            slug: 'cement',
            name: 'Cement',
            description: 'OPC, PPC, and PSC grade cements',
            displayOrder: 1,
          },
          {
            slug: 'sand-aggregates',
            name: 'Sand & Aggregates',
            description: 'M-Sand, P-Sand, and gravel aggregates',
            displayOrder: 2,
          },
          {
            slug: 'bricks-blocks',
            name: 'Bricks & AAC Blocks',
            description: 'Clay red bricks and autoclaved aerated concrete blocks',
            displayOrder: 3,
          },
        ],
      },
      {
        slug: 'steel-structural',
        name: 'Steel & Structural',
        description: 'TMT reinforcement bars, structural steel beams, and binding wire',
        displayOrder: 2,
        subcategories: [
          {
            slug: 'tmt-rebars',
            name: 'TMT Rebars',
            description: 'Fe 500D, Fe 550D reinforcement steel bars',
            displayOrder: 1,
          },
          {
            slug: 'binding-wire-mesh',
            name: 'Binding Wire & Mesh',
            description: 'Annealed binding wires and welded wire fabric',
            displayOrder: 2,
          },
        ],
      },
      {
        slug: 'plumbing-sanitaryware',
        name: 'Plumbing & Sanitaryware',
        description: 'Pipes, fittings, valves, and water storage',
        displayOrder: 3,
        subcategories: [
          {
            slug: 'cpvc-pipes-fittings',
            name: 'CPVC Pipes & Fittings',
            description: 'Chlorinated polyvinyl chloride hot/cold water plumbing pipes',
            displayOrder: 1,
          },
          {
            slug: 'overhead-water-tanks',
            name: 'Overhead Water Tanks',
            description: 'Multi-layer food-grade polyethylene water storage tanks',
            displayOrder: 2,
          },
        ],
      },
      {
        slug: 'electrical-lighting',
        name: 'Electrical & Lighting',
        description: 'Conduits, wiring cables, switches, and distribution boards',
        displayOrder: 4,
        subcategories: [
          {
            slug: 'wires-cables',
            name: 'Wires & Cables',
            description: 'FR / FRLS copper electrical building wires',
            displayOrder: 1,
          },
          {
            slug: 'conduits-fittings',
            name: 'PVC Conduits & Accessories',
            description: 'Heavy duty electrical casing and piping',
            displayOrder: 2,
          },
        ],
      },
    ];

    let seeded = 0;
    let updated = 0;

    for (const rootData of SEED_DATA) {
      let root = await CategoryModel.findOne({ slug: rootData.slug }).collation({
        locale: 'en',
        strength: 2,
      });
      if (!root) {
        root = await CategoryModel.create({
          slug: rootData.slug,
          name: rootData.name,
          description: rootData.description,
          parentId: null,
          level: 0,
          displayOrder: rootData.displayOrder,
          isActive: true,
        });
        seeded++;
      } else {
        root.name = rootData.name;
        root.description = rootData.description;
        root.displayOrder = rootData.displayOrder;
        await root.save();
        updated++;
      }

      for (const subData of rootData.subcategories) {
        const sub = await CategoryModel.findOne({ slug: subData.slug }).collation({
          locale: 'en',
          strength: 2,
        });
        if (!sub) {
          await CategoryModel.create({
            slug: subData.slug,
            name: subData.name,
            description: subData.description,
            parentId: root._id,
            level: 1,
            displayOrder: subData.displayOrder,
            isActive: true,
          });
          seeded++;
        } else {
          sub.name = subData.name;
          sub.description = subData.description;
          sub.parentId = root._id;
          sub.level = 1;
          sub.displayOrder = subData.displayOrder;
          await sub.save();
          updated++;
        }
      }
    }

    return { seeded, updated };
  }
}

export const categoryService = new CategoryService();
