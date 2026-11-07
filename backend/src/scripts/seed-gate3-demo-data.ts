import mongoose from 'mongoose';
import { connectDatabase, disconnectDatabase } from '../database/database.js';
import { getConfig } from '../config/env.js';
import { logger } from '../logger/logger.js';
import { ProductModel } from '../models/product.model.js';
import { ProductVariantModel } from '../models/product-variant.model.js';
import { ProductPricingModel } from '../models/product-pricing.model.js';
import { SkuRegistryModel } from '../models/sku-registry.model.js';
import { CategoryModel } from '../models/category.model.js';
import { ServiceAreaModel } from '../models/service-area.model.js';
import { PartnerModel } from '../models/partner.model.js';
import { PartnerProductModel } from '../models/partner-product.model.js';
import { UserModel } from '../models/user.model.js';
import { categoryService } from '../services/catalog/category.service.js';
import { serviceAreaService } from '../services/service-area/service-area.service.js';
import { seedApprovedUnits } from '../seeds/units.seed.js';
import { UserType, UserStatus, DeliveryMode, type IB2BVolumeTier } from '@thehomez/shared-types';

/**
 * Gate 3 Demo Seed Marker & Isolation Constants
 */
export const DEMO_TAG = 'DEMO_SEED_GATE3';
export const DEMO_SKU_PREFIX = 'DEMO-';
export const DEMO_SLUG_PREFIX = 'demo-';
export const DEMO_ADMIN_PHONE = '+919999900001';
export const DEMO_PARTNER_PHONE = '+919888800001';
export const DEMO_PARTNER_NAME = 'Bengaluru BuildTech Supplies (Sample Demo Partner)';
export const DEMO_SERVICE_AREA_CODE = 'BLR-CENTRAL';
export const DEMO_SERVICEABLE_PIN = '560001';
export const DEMO_UNSERVICEABLE_PIN = '570001';

export const APPROVED_LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

export interface IDemoSeedOptions {
  confirm?: boolean;
  dryRun?: boolean;
  cleanup?: boolean;
  allowRemoteDemoDb?: boolean;
}

export interface IParsedMongoUri {
  protocol: string;
  hosts: string[];
  databaseName: string;
  sanitizedUri: string;
}

/**
 * Parses MongoDB connection URIs to extract protocol, target hosts, database name,
 * and creates a credentials-sanitized URI string for safe logging and diagnostics.
 */
export function parseMongoUri(rawUri: string): IParsedMongoUri {
  if (!rawUri || typeof rawUri !== 'string') {
    throw new Error('MongoDB URI must be a non-empty string');
  }

  const uriMatch = rawUri.match(
    /^(mongodb(?:\+srv)?):\/\/(?:([^@]+)@)?([^/?#]+)(?:\/([^?#]*))?(?:\?(.*))?$/,
  );
  if (!uriMatch) {
    throw new Error(`Invalid MongoDB connection URI format.`);
  }

  const protocol = uriMatch[1];
  const hostString = uriMatch[3];
  if (!protocol || !hostString) {
    throw new Error('Invalid MongoDB connection URI format.');
  }
  const dbPart = uriMatch[4] || '';
  const query = uriMatch[5];

  const hostItems = hostString
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  const hosts: string[] = [];

  for (const item of hostItems) {
    let hostname = item;
    if (item.startsWith('[')) {
      const closeBracket = item.indexOf(']');
      if (closeBracket !== -1) {
        hostname = item.slice(1, closeBracket);
      }
    } else {
      const colonIndex = item.lastIndexOf(':');
      if (colonIndex !== -1 && !item.includes('::')) {
        hostname = item.slice(0, colonIndex);
      } else if (item.startsWith('::1')) {
        hostname = '::1';
      }
    }
    hosts.push(hostname.toLowerCase());
  }

  const databaseName = dbPart.trim();
  const sanitizedHostPart = hostItems.join(',');
  const pathPart = databaseName ? `/${databaseName}` : '';
  const queryPart = query ? `?${query}` : '';
  const sanitizedUri = `${protocol}://${sanitizedHostPart}${pathPart}${queryPart}`;

  return {
    protocol,
    hosts,
    databaseName,
    sanitizedUri,
  };
}

export interface IDemoSeedSummary {
  mode: 'DRY_RUN' | 'EXECUTE' | 'CLEANUP';
  usersAffected: number;
  partnersAffected: number;
  serviceAreasAffected: number;
  productsAffected: number;
  variantsAffected: number;
  pricingRecordsAffected: number;
  availabilityRecordsAffected: number;
  skuRegistryRecordsAffected: number;
  details: string[];
}

/**
 * Validates environment guard:
 * 1. Permanently blocks execution in production (NODE_ENV=production or config.isProduction).
 * 2. Restricts target MongoDB hosts to explicitly approved local development hosts (localhost, 127.0.0.1, ::1).
 * 3. Prohibits remote MongoDB hosts by default, even in development or unset environments.
 * 4. Permits remote demo hosts ONLY when --allow-remote-demo-db is explicitly set AND database name contains 'demo',
 *    strictly blocking any target database containing 'prod' or 'production'.
 */
export function assertSafeEnvironment(
  options?: IDemoSeedOptions,
  customUri?: string,
): IParsedMongoUri {
  const config = getConfig();
  if (config.isProduction || process.env.NODE_ENV === 'production') {
    throw new Error(
      'FATAL: Gate 3 Demo Dataset seeding is permanently prohibited in production environments (NODE_ENV=production).',
    );
  }

  const rawUri = customUri || config.mongodb.uri;
  const parsed = parseMongoUri(rawUri);

  const areAllHostsLocal =
    parsed.hosts.length > 0 && parsed.hosts.every((host) => APPROVED_LOCAL_HOSTS.has(host));

  if (!areAllHostsLocal) {
    if (!options?.allowRemoteDemoDb) {
      throw new Error(
        `FATAL: Remote MongoDB host(s) detected [${parsed.hosts.join(', ')}]. By default, demo seeding is restricted to approved local development hosts (localhost, 127.0.0.1, ::1). Remote execution requires explicit --allow-remote-demo-db opt-in.`,
      );
    }

    if (/prod|production/i.test(parsed.databaseName)) {
      throw new Error(
        `FATAL: Remote demo override strictly forbids targeting production databases. Database name: '${parsed.databaseName}'.`,
      );
    }

    if (!/demo/i.test(parsed.databaseName)) {
      throw new Error(
        `FATAL: Remote demo override requires an explicit demo database name containing 'demo' (e.g., 'thehomez-demo'). Received database name: '${parsed.databaseName}'.`,
      );
    }
  }

  return parsed;
}

/**
 * Core demo dataset definition structures
 */
interface IDemoVariantDef {
  sku: string;
  title: string;
  attributes: Record<string, string>;
  images: string[];
  unitCode: string;
  quantityPrecision: number;
  minOrderQuantity: string;
  stepIncrement: string;
  // Pricing
  globalB2cPricePaise: number;
  globalB2cMrpPaise: number;
  globalB2bPricePaise: number;
  globalB2bTiers?: IB2BVolumeTier[];
  regionalB2cPricePaise?: number;
  regionalB2cMrpPaise?: number;
  regionalB2bPricePaise?: number;
  regionalB2bTiers?: IB2BVolumeTier[];
  // Partner stock availability in BLR-CENTRAL
  isAvailableInCentral: boolean;
  minLeadTimeHours: number;
}

interface IDemoProductDef {
  title: string;
  slug: string;
  brand: string;
  description: string;
  categorySlug: string;
  subcategorySlug: string;
  hasVariants: boolean;
  sku?: string; // only if standalone
  unitCode?: string;
  quantityPrecision?: number;
  minOrderQuantity?: string;
  stepIncrement?: string;
  images: string[];
  specifications: Record<string, string>;
  // Standalone pricing (if hasVariants: false)
  globalB2cPricePaise?: number;
  globalB2cMrpPaise?: number;
  globalB2bPricePaise?: number;
  globalB2bTiers?: IB2BVolumeTier[];
  regionalB2cPricePaise?: number;
  regionalB2cMrpPaise?: number;
  regionalB2bPricePaise?: number;
  regionalB2bTiers?: IB2BVolumeTier[];
  isAvailableInCentral?: boolean;
  minLeadTimeHours?: number;
  // Variants (if hasVariants: true)
  variants?: IDemoVariantDef[];
}

/**
 * 5 Comprehensive Catalogue Scenarios:
 * 1. UltraTech Super Cement 50kg (Standalone, BAG, 0 precision, Regional Price Override in BLR-CENTRAL, B2B volume tiers, in-stock 12h lead time).
 * 2. Tata Tiscon 550D TMT Rebars (Multi-Variant, TONNE, 2 precision, 8mm/10mm/12mm in-stock, 16mm out-of-stock, B2B wholesale tiers).
 * 3. Wienerberger Porotherm Clay Bricks (Standalone, PIECE, 0 precision, min 100 step 50, B2B wholesale tiers, in-stock 48h lead time).
 * 4. Supreme CPVC FlowGuard Plus Pipes (Multi-Variant, PIECE, 0 precision, 20mm and 25mm variants, in-stock 24h lead time).
 * 5. Havells Life Line Plus 1.5 sq mm Wire (Standalone, BUNDLE, 0 precision, in-stock 24h lead time).
 */
export const DEMO_PRODUCTS: IDemoProductDef[] = [
  {
    title: 'UltraTech Super Cement (50kg Bag) - Demo',
    slug: `${DEMO_SLUG_PREFIX}ultratech-super-cement-50kg`,
    brand: 'UltraTech Cement',
    description:
      '[DEMO DATA - Illustrative purpose only] Portland Pozzolana Cement (PPC) engineered for heavy-duty structural concrete, plastering and masonry works. Manufactured using micro-fine fly ash for enhanced durability and crack resistance.',
    categorySlug: 'civil-construction',
    subcategorySlug: 'cement',
    hasVariants: false,
    sku: `${DEMO_SKU_PREFIX}CEM-ULT-50KG`,
    unitCode: 'BAG',
    quantityPrecision: 0,
    minOrderQuantity: '10',
    stepIncrement: '5',
    images: ['https://placehold.co/600x400/e2e8f0/1e293b?text=UltraTech+Super+Cement+50kg'],
    specifications: {
      Grade: 'PPC (Portland Pozzolana Cement)',
      'Bag Weight': '50 kg',
      Standard: 'IS 1489 Part 1',
      SettingTime: 'Initial >= 30 min, Final <= 600 min',
    },
    // Global Pricing: B2C ₹390 (39000 paise), MRP ₹430 (43000 paise), B2B ₹370 (37000 paise)
    globalB2cPricePaise: 39000,
    globalB2cMrpPaise: 43000,
    globalB2bPricePaise: 37000,
    globalB2bTiers: [
      { minQuantity: '50', pricePaise: 36000 },
      { minQuantity: '200', pricePaise: 35000 },
    ],
    // Regional Override for BLR-CENTRAL: B2C ₹380 (38000 paise), MRP ₹420, B2B ₹360 (36000 paise)
    regionalB2cPricePaise: 38000,
    regionalB2cMrpPaise: 42000,
    regionalB2bPricePaise: 36000,
    regionalB2bTiers: [
      { minQuantity: '50', pricePaise: 35000 },
      { minQuantity: '200', pricePaise: 34000 },
    ],
    isAvailableInCentral: true,
    minLeadTimeHours: 12,
  },
  {
    title: 'Tata Tiscon 550D High-Strength TMT Rebars - Demo',
    slug: `${DEMO_SLUG_PREFIX}tata-tiscon-550d-tmt-rebars`,
    brand: 'Tata Tiscon',
    description:
      '[DEMO DATA - Illustrative purpose only] Superior Fe 550D grade Thermo Mechanically Treated reinforcement steel rebars. Provides superior bendability, earthquake resistance, and bonding strength with concrete.',
    categorySlug: 'steel-structural',
    subcategorySlug: 'tmt-rebars',
    hasVariants: true,
    images: ['https://placehold.co/600x400/e2e8f0/1e293b?text=Tata+Tiscon+550D+TMT+Rebars'],
    specifications: {
      Grade: 'Fe 550D',
      Standard: 'IS 1786:2008',
      'Corrosion Resistance': 'High Ductility (CRS)',
      Length: '12 Metres standard bundle',
    },
    variants: [
      {
        sku: `${DEMO_SKU_PREFIX}STL-TISCON-8MM`,
        title: '8mm Diameter (Fe 550D)',
        attributes: { Diameter: '8 mm' },
        images: ['https://placehold.co/600x400/e2e8f0/1e293b?text=Tata+Tiscon+8mm'],
        unitCode: 'TONNE',
        quantityPrecision: 2,
        minOrderQuantity: '0.50',
        stepIncrement: '0.25',
        globalB2cPricePaise: 6100000, // ₹61,000 / tonne
        globalB2cMrpPaise: 6500000, // ₹65,000 / tonne
        globalB2bPricePaise: 5800000, // ₹58,000 / tonne
        globalB2bTiers: [
          { minQuantity: '2.00', pricePaise: 5600000 },
          { minQuantity: '5.00', pricePaise: 5400000 },
        ],
        isAvailableInCentral: true,
        minLeadTimeHours: 24,
      },
      {
        sku: `${DEMO_SKU_PREFIX}STL-TISCON-10MM`,
        title: '10mm Diameter (Fe 550D)',
        attributes: { Diameter: '10 mm' },
        images: ['https://placehold.co/600x400/e2e8f0/1e293b?text=Tata+Tiscon+10mm'],
        unitCode: 'TONNE',
        quantityPrecision: 2,
        minOrderQuantity: '0.50',
        stepIncrement: '0.25',
        globalB2cPricePaise: 6000000, // ₹60,000 / tonne
        globalB2cMrpPaise: 6400000, // ₹64,000 / tonne
        globalB2bPricePaise: 5700000, // ₹57,000 / tonne
        globalB2bTiers: [
          { minQuantity: '2.00', pricePaise: 5500000 },
          { minQuantity: '5.00', pricePaise: 5300000 },
        ],
        isAvailableInCentral: true,
        minLeadTimeHours: 24,
      },
      {
        sku: `${DEMO_SKU_PREFIX}STL-TISCON-12MM`,
        title: '12mm Diameter (Fe 550D)',
        attributes: { Diameter: '12 mm' },
        images: ['https://placehold.co/600x400/e2e8f0/1e293b?text=Tata+Tiscon+12mm'],
        unitCode: 'TONNE',
        quantityPrecision: 2,
        minOrderQuantity: '0.50',
        stepIncrement: '0.25',
        globalB2cPricePaise: 5900000, // ₹59,000 / tonne
        globalB2cMrpPaise: 6300000, // ₹63,000 / tonne
        globalB2bPricePaise: 5600000, // ₹56,000 / tonne
        globalB2bTiers: [
          { minQuantity: '2.00', pricePaise: 5400000 },
          { minQuantity: '5.00', pricePaise: 5200000 },
        ],
        isAvailableInCentral: true,
        minLeadTimeHours: 24,
      },
      {
        // Out of Stock scenario: Priced, but isAvailableInCentral is FALSE
        sku: `${DEMO_SKU_PREFIX}STL-TISCON-16MM`,
        title: '16mm Diameter (Fe 550D) [Demo Out-of-Stock]',
        attributes: { Diameter: '16 mm' },
        images: ['https://placehold.co/600x400/e2e8f0/1e293b?text=Tata+Tiscon+16mm+OOS'],
        unitCode: 'TONNE',
        quantityPrecision: 2,
        minOrderQuantity: '0.50',
        stepIncrement: '0.25',
        globalB2cPricePaise: 5900000,
        globalB2cMrpPaise: 6300000,
        globalB2bPricePaise: 5600000,
        globalB2bTiers: [
          { minQuantity: '2.00', pricePaise: 5400000 },
          { minQuantity: '5.00', pricePaise: 5200000 },
        ],
        isAvailableInCentral: false, // Explicitly out of stock / unavailable
        minLeadTimeHours: 72,
      },
    ],
  },
  {
    title: 'Wienerberger Porotherm Clay Hollow Bricks - Demo',
    slug: `${DEMO_SLUG_PREFIX}wienerberger-porotherm-bricks`,
    brand: 'Wienerberger',
    description:
      '[DEMO DATA - Illustrative purpose only] High-precision perforated horizontally hollow clay bricks engineered for non-load-bearing infill masonry. 60% lighter than traditional solid clay bricks with excellent thermal insulation.',
    categorySlug: 'civil-construction',
    subcategorySlug: 'bricks-blocks',
    hasVariants: false,
    sku: `${DEMO_SKU_PREFIX}BRK-WIEN-01`,
    unitCode: 'PIECE',
    quantityPrecision: 0,
    minOrderQuantity: '100',
    stepIncrement: '50',
    images: ['https://placehold.co/600x400/e2e8f0/1e293b?text=Wienerberger+Porotherm+Bricks'],
    specifications: {
      Dimensions: '400 x 200 x 200 mm',
      'Compressive Strength': '3.5 N/mm²',
      Density: '690 - 790 kg/m³',
      Weight: 'approx 7.2 kg / piece',
    },
    globalB2cPricePaise: 4500, // ₹45 / piece
    globalB2cMrpPaise: 5000, // ₹50 / piece
    globalB2bPricePaise: 4000, // ₹40 / piece
    globalB2bTiers: [
      { minQuantity: '500', pricePaise: 3800 },
      { minQuantity: '2000', pricePaise: 3500 },
    ],
    isAvailableInCentral: true,
    minLeadTimeHours: 48,
  },
  {
    title: 'Supreme CPVC FlowGuard Plus Hot & Cold Pipes - Demo',
    slug: `${DEMO_SLUG_PREFIX}supreme-cpvc-flowguard-pipes`,
    brand: 'Supreme',
    description:
      '[DEMO DATA - Illustrative purpose only] Chlorinated Polyvinyl Chloride (CPVC) SDR 11 pressure pipes for residential and commercial hot and cold potable water distribution. Corrosion-proof and bacteriologically neutral.',
    categorySlug: 'plumbing-sanitaryware',
    subcategorySlug: 'cpvc-pipes-fittings',
    hasVariants: true,
    images: ['https://placehold.co/600x400/e2e8f0/1e293b?text=Supreme+CPVC+FlowGuard+Pipes'],
    specifications: {
      Material: 'CPVC (Class 1)',
      Standard: 'IS 15778 / ASTM D2846 (SDR 11)',
      WorkingPressure: '28.1 kg/cm² at 23°C',
      Length: '3 Metres per pipe',
    },
    variants: [
      {
        sku: `${DEMO_SKU_PREFIX}PLM-SUP-20MM`,
        title: '3/4 inch (20mm) x 3m (SDR 11)',
        attributes: { Size: '20mm (3/4")', Length: '3 Metres' },
        images: ['https://placehold.co/600x400/e2e8f0/1e293b?text=Supreme+CPVC+20mm'],
        unitCode: 'PIECE',
        quantityPrecision: 0,
        minOrderQuantity: '5',
        stepIncrement: '1',
        globalB2cPricePaise: 28000, // ₹280 / piece
        globalB2cMrpPaise: 32000, // ₹320 / piece
        globalB2bPricePaise: 26000, // ₹260 / piece
        globalB2bTiers: [
          { minQuantity: '20', pricePaise: 24500 },
          { minQuantity: '50', pricePaise: 23000 },
        ],
        isAvailableInCentral: true,
        minLeadTimeHours: 24,
      },
      {
        sku: `${DEMO_SKU_PREFIX}PLM-SUP-25MM`,
        title: '1 inch (25mm) x 3m (SDR 11)',
        attributes: { Size: '25mm (1")', Length: '3 Metres' },
        images: ['https://placehold.co/600x400/e2e8f0/1e293b?text=Supreme+CPVC+25mm'],
        unitCode: 'PIECE',
        quantityPrecision: 0,
        minOrderQuantity: '5',
        stepIncrement: '1',
        globalB2cPricePaise: 38000, // ₹380 / piece
        globalB2cMrpPaise: 44000, // ₹440 / piece
        globalB2bPricePaise: 35000, // ₹350 / piece
        globalB2bTiers: [
          { minQuantity: '20', pricePaise: 33000 },
          { minQuantity: '50', pricePaise: 31000 },
        ],
        isAvailableInCentral: true,
        minLeadTimeHours: 24,
      },
    ],
  },
  {
    title: 'Havells Life Line Plus S3 HRFR Copper Wire 1.5 sq mm (90m) - Demo',
    slug: `${DEMO_SLUG_PREFIX}havells-lifeline-plus-1-5sqmm-wire`,
    brand: 'Havells',
    description:
      '[DEMO DATA - Illustrative purpose only] 100% electrolytic grade pure bare copper multi-strand building electrical wire with heat-resistant flame retardant (HRFR) PVC insulation. 90 metre standard coil.',
    categorySlug: 'electrical-lighting',
    subcategorySlug: 'wires-cables',
    hasVariants: false,
    sku: `${DEMO_SKU_PREFIX}ELE-HAV-15`,
    unitCode: 'BUNDLE',
    quantityPrecision: 0,
    minOrderQuantity: '1',
    stepIncrement: '1',
    images: ['https://placehold.co/600x400/e2e8f0/1e293b?text=Havells+LifeLine+Plus+1.5sqmm'],
    specifications: {
      Conductor: 'Electrolytic Bare Copper',
      'Nominal Area': '1.5 sq mm',
      Length: '90 Metres',
      Insulation: 'HRFR (Heat Resistant Flame Retardant)',
      Standard: 'IS 694',
    },
    globalB2cPricePaise: 185000, // ₹1,850 / coil
    globalB2cMrpPaise: 220000, // ₹2,200 / coil
    globalB2bPricePaise: 170000, // ₹1,700 / coil
    globalB2bTiers: [
      { minQuantity: '5', pricePaise: 162000 },
      { minQuantity: '20', pricePaise: 155000 },
    ],
    isAvailableInCentral: true,
    minLeadTimeHours: 24,
  },
];

/**
 * Execute demo dataset cleanup: safely removes ONLY records generated by this demo seed.
 */
export async function cleanupDemoData(
  options: IDemoSeedOptions = { confirm: true },
): Promise<IDemoSeedSummary> {
  const parsedUri = assertSafeEnvironment(options);

  if (options.confirm !== true) {
    throw new Error(
      'FATAL: Demo data cleanup requires explicit confirmation (confirm: true or --confirm).',
    );
  }

  logger.info(
    {
      targetHosts: parsedUri.hosts,
      databaseName: parsedUri.databaseName,
      sanitizedUri: parsedUri.sanitizedUri,
    },
    'Starting cleanup of Gate 3 Demo Dataset records...',
  );

  // 1. Identify demo staff user
  const demoUser = await UserModel.findOne({
    phone: DEMO_ADMIN_PHONE,
    'metadata.tag': DEMO_TAG,
  });
  const demoUserId = demoUser?._id;

  // 2. Identify demo partner
  const demoPartner = await PartnerModel.findOne({
    phone: DEMO_PARTNER_PHONE,
    'metadata.tag': DEMO_TAG,
  });
  const demoPartnerId = demoPartner?._id;

  // 3. Find demo products by slug prefix or SKU prefix
  const demoProducts = await ProductModel.find({
    $or: [
      { slug: new RegExp(`^${DEMO_SLUG_PREFIX}`, 'i') },
      { sku: new RegExp(`^${DEMO_SKU_PREFIX}`, 'i') },
    ],
  });
  const demoProductIds = demoProducts.map((p) => p._id);

  // 4. Find demo variants
  const demoVariants = await ProductVariantModel.find({
    $or: [{ productId: { $in: demoProductIds } }, { sku: new RegExp(`^${DEMO_SKU_PREFIX}`, 'i') }],
  });
  const demoVariantIds = demoVariants.map((v) => v._id);

  // 5. Delete PartnerProducts - tightly scoped to demo partner and demo products/variants
  const availRes = await PartnerProductModel.deleteMany({
    $and: [
      ...(demoPartnerId ? [{ partnerId: demoPartnerId }] : []),
      {
        $or: [
          { productId: { $in: demoProductIds } },
          ...(demoVariantIds.length > 0 ? [{ variantId: { $in: demoVariantIds } }] : []),
        ],
      },
    ],
  });

  // 6. Delete ProductPricing
  const pricingRes = await ProductPricingModel.deleteMany({
    $or: [
      { productId: { $in: demoProductIds } },
      ...(demoVariantIds.length > 0 ? [{ variantId: { $in: demoVariantIds } }] : []),
    ],
  });

  // 7. Delete SkuRegistry entries
  const skuRes = await SkuRegistryModel.deleteMany({
    sku: new RegExp(`^${DEMO_SKU_PREFIX}`, 'i'),
  });

  // 8. Delete ProductVariants
  const variantRes = await ProductVariantModel.deleteMany({
    _id: { $in: demoVariantIds },
  });

  // 9. Delete Products
  const prodRes = await ProductModel.deleteMany({
    _id: { $in: demoProductIds },
  });

  // 10. Delete Partner
  let partnersAffected = 0;
  if (demoPartnerId) {
    await PartnerModel.deleteOne({ _id: demoPartnerId, 'metadata.tag': DEMO_TAG });
    partnersAffected = 1;
  }

  // 11. Delete Demo User
  let usersAffected = 0;
  if (demoUserId) {
    await UserModel.deleteOne({ _id: demoUserId, 'metadata.tag': DEMO_TAG });
    usersAffected = 1;
  }

  const summary: IDemoSeedSummary = {
    mode: 'CLEANUP',
    usersAffected,
    partnersAffected,
    serviceAreasAffected: 0, // We preserve service areas as they are shared infrastructure
    productsAffected: prodRes.deletedCount,
    variantsAffected: variantRes.deletedCount,
    pricingRecordsAffected: pricingRes.deletedCount,
    availabilityRecordsAffected: availRes.deletedCount,
    skuRegistryRecordsAffected: skuRes.deletedCount,
    details: [
      `Target DB: Host(s): ${parsedUri.hosts.join(', ')} | Name: ${parsedUri.databaseName || '(default)'}`,
      `Removed ${prodRes.deletedCount} demo products (${DEMO_PRODUCTS.map((p) => p.slug).join(', ')})`,
      `Removed ${variantRes.deletedCount} demo product variants`,
      `Removed ${pricingRes.deletedCount} demo pricing records`,
      `Removed ${availRes.deletedCount} demo partner availability records`,
      `Removed ${skuRes.deletedCount} demo SKU registry reservations`,
      `Removed demo partner: ${partnersAffected > 0 ? DEMO_PARTNER_NAME : 'None found'}`,
      `Removed demo staff user: ${usersAffected > 0 ? DEMO_ADMIN_PHONE : 'None found'}`,
    ],
  };

  logger.info(summary, 'Gate 3 Demo Dataset cleanup completed');
  return summary;
}

/**
 * Executes or previews the demo dataset seeding.
 */
export async function seedDemoData(options: IDemoSeedOptions = {}): Promise<IDemoSeedSummary> {
  const parsedUri = assertSafeEnvironment(options);

  const isConfirmed = options.confirm === true;
  const isDryRun = options.dryRun === true || !isConfirmed;

  logger.info(
    {
      targetHosts: parsedUri.hosts,
      databaseName: parsedUri.databaseName,
      sanitizedUri: parsedUri.sanitizedUri,
      mode: isDryRun ? 'DRY_RUN' : 'EXECUTE',
    },
    'Starting Gate 3 Demo Dataset seed processing...',
  );

  const details: string[] = [
    `[TARGET DB] Host(s): ${parsedUri.hosts.join(', ')} | DB: ${parsedUri.databaseName || '(default)'} | Sanitized URI: ${parsedUri.sanitizedUri}`,
  ];

  // Summary counters
  let usersAffected = 0;
  let partnersAffected = 0;
  let serviceAreasAffected = 0;
  let productsAffected = 0;
  let variantsAffected = 0;
  let pricingRecordsAffected = 0;
  let availabilityRecordsAffected = 0;
  let skuRegistryRecordsAffected = 0;

  // 1. Ensure baseline units and categories exist
  if (!isDryRun) {
    await seedApprovedUnits();
    await categoryService.seedInitialCategories();
    await serviceAreaService.seedBengaluruServiceAreas();
  }

  // 2. Resolve Service Area (Bengaluru Central GPO: 560001)
  let centralArea = await ServiceAreaModel.findOne({ code: DEMO_SERVICE_AREA_CODE });
  if (!centralArea) {
    if (isDryRun) {
      details.push(
        `[PROPOSED INSERT] ServiceArea: ${DEMO_SERVICE_AREA_CODE} (${DEMO_SERVICEABLE_PIN})`,
      );
      serviceAreasAffected++;
    } else {
      centralArea = await ServiceAreaModel.create({
        code: DEMO_SERVICE_AREA_CODE,
        name: 'Bengaluru Central (GPO)',
        city: 'Bengaluru',
        state: 'Karnataka',
        countryCode: 'IN',
        pincodes: [DEMO_SERVICEABLE_PIN],
        deliveryRadiusKm: 15,
        isActive: true,
      });
      serviceAreasAffected++;
      details.push(`[CREATED] ServiceArea: ${centralArea.code}`);
    }
  } else {
    details.push(`[REUSED EXISTING] ServiceArea: ${centralArea.code} (${centralArea.name})`);
  }

  // 3. Resolve or Create Demo Staff User
  let demoUser = await UserModel.findOne({ phone: DEMO_ADMIN_PHONE });
  if (demoUser && demoUser.metadata?.tag !== DEMO_TAG) {
    throw new Error(
      `Conflict: Existing user found with phone '${DEMO_ADMIN_PHONE}' without '${DEMO_TAG}' ownership. Natural-key collision prevented.`,
    );
  }
  if (!demoUser) {
    if (isDryRun) {
      details.push(`[PROPOSED INSERT] Demo Staff User: ${DEMO_ADMIN_PHONE} (STAFF/ADMIN)`);
      usersAffected++;
    } else {
      demoUser = await UserModel.create({
        phone: DEMO_ADMIN_PHONE,
        userType: UserType.STAFF,
        status: UserStatus.ACTIVE,
        roles: ['ADMIN', 'CATALOG_WRITE'],
        metadata: { tag: DEMO_TAG, isDemo: true },
      });
      usersAffected++;
      details.push(`[CREATED] Demo Staff User: ${demoUser.phone}`);
    }
  } else {
    details.push(`[REUSED EXISTING] Demo Staff User: ${demoUser.phone}`);
  }

  const effectiveUserId = demoUser?._id || new mongoose.Types.ObjectId();

  // 4. Resolve or Create Demo Verified Partner
  let demoPartner = await PartnerModel.findOne({ phone: DEMO_PARTNER_PHONE });
  if (demoPartner && demoPartner.metadata?.tag !== DEMO_TAG) {
    throw new Error(
      `Conflict: Existing partner found with phone '${DEMO_PARTNER_PHONE}' without '${DEMO_TAG}' ownership. Natural-key collision prevented.`,
    );
  }
  const centralAreaId = centralArea?._id || new mongoose.Types.ObjectId();

  if (!demoPartner) {
    if (isDryRun) {
      details.push(
        `[PROPOSED INSERT] Demo Verified Partner: ${DEMO_PARTNER_NAME} (${DEMO_PARTNER_PHONE}) covering ${DEMO_SERVICE_AREA_CODE}`,
      );
      partnersAffected++;
    } else {
      demoPartner = await PartnerModel.create({
        businessName: DEMO_PARTNER_NAME,
        legalName: 'Bengaluru BuildTech Wholesale Pvt Ltd (Sample)',
        phone: DEMO_PARTNER_PHONE,
        email: 'sample.partner@thehomez.local',
        serviceAreaIds: [centralAreaId],
        status: 'ACTIVE',
        deliveryMode: DeliveryMode.PARTNER_MANAGED,
        metadata: { tag: DEMO_TAG, isDemo: true },
      });
      partnersAffected++;
      details.push(`[CREATED] Demo Partner: ${demoPartner.businessName}`);
    }
  } else {
    if (!isDryRun && !demoPartner.serviceAreaIds.some((id) => id.equals(centralAreaId))) {
      demoPartner.serviceAreaIds.push(centralAreaId);
      await demoPartner.save();
      partnersAffected++;
      details.push(
        `[UPDATED] Demo Partner serviceAreaIds updated to include ${DEMO_SERVICE_AREA_CODE}`,
      );
    } else {
      details.push(`[REUSED EXISTING] Demo Partner: ${demoPartner.businessName}`);
    }
  }

  const effectivePartnerId = demoPartner?._id || new mongoose.Types.ObjectId();

  // 5. Seed Demo Products & Variants
  for (const pDef of DEMO_PRODUCTS) {
    // Look up root and sub category
    let rootCat = await CategoryModel.findOne({ slug: pDef.categorySlug });
    let subCat = await CategoryModel.findOne({ slug: pDef.subcategorySlug });

    if (!rootCat || !subCat) {
      if (!isDryRun) {
        throw new Error(
          `Category hierarchy missing: ${pDef.categorySlug}/${pDef.subcategorySlug}. Ensure categories seed ran first.`,
        );
      }
      // For dry-run, create dummy IDs if DB is empty
      rootCat = rootCat || ({ _id: new mongoose.Types.ObjectId() } as any);
      subCat = subCat || ({ _id: new mongoose.Types.ObjectId() } as any);
    }

    // Collision check: verify no non-demo product exists with this slug or standalone SKU
    const existingBySlug = await ProductModel.findOne({ slug: pDef.slug });
    if (existingBySlug) {
      const isDemoSlug = existingBySlug.slug.startsWith(DEMO_SLUG_PREFIX);
      const isDemoSku = !existingBySlug.sku || existingBySlug.sku.startsWith(DEMO_SKU_PREFIX);
      if (!isDemoSlug || !isDemoSku) {
        throw new Error(
          `Conflict: Existing non-demo product found with slug '${pDef.slug}'. Natural-key collision prevented.`,
        );
      }
    }

    if (pDef.sku) {
      const existingBySku = await ProductModel.findOne({ sku: pDef.sku });
      if (
        existingBySku &&
        existingBySlug &&
        existingBySku._id.toString() !== existingBySlug._id.toString()
      ) {
        throw new Error(
          `Conflict: Existing product with SKU '${pDef.sku}' does not match product slug '${pDef.slug}'. Natural-key collision prevented.`,
        );
      }
      if (existingBySku && !existingBySku.sku?.startsWith(DEMO_SKU_PREFIX)) {
        throw new Error(
          `Conflict: Existing non-demo product found with SKU '${pDef.sku}'. Natural-key collision prevented.`,
        );
      }

      const existingSkuReg = await SkuRegistryModel.findOne({
        normalizedSku: pDef.sku.toUpperCase(),
      });
      if (existingSkuReg && !existingSkuReg.sku.startsWith(DEMO_SKU_PREFIX)) {
        throw new Error(
          `Conflict: Existing non-demo SKU Registry record found for '${pDef.sku}'. Natural-key collision prevented.`,
        );
      }
    }

    let existingProduct = existingBySlug;

    if (!existingProduct) {
      if (isDryRun) {
        details.push(
          `[PROPOSED INSERT] Product: ${pDef.title} (${pDef.slug}) | Brand: ${pDef.brand} | HasVariants: ${pDef.hasVariants}`,
        );
        productsAffected++;
        if (pDef.sku) {
          skuRegistryRecordsAffected++;
        }
      } else {
        const newProduct = new ProductModel({
          slug: pDef.slug,
          title: pDef.title,
          brand: pDef.brand,
          description: pDef.description,
          categoryId: rootCat!._id,
          subcategoryId: subCat!._id,
          hasVariants: pDef.hasVariants,
          sku: pDef.hasVariants ? null : pDef.sku,
          status: 'ACTIVE',
          images: pDef.images,
          specifications: pDef.specifications,
          unitCode: pDef.hasVariants ? null : pDef.unitCode,
          quantityPrecision: pDef.hasVariants ? null : pDef.quantityPrecision,
          minOrderQuantity: pDef.hasVariants ? null : pDef.minOrderQuantity,
          stepIncrement: pDef.hasVariants ? null : pDef.stepIncrement,
          publishedBy: effectiveUserId,
          publishedAt: new Date(),
          createdBy: effectiveUserId,
          updatedBy: effectiveUserId,
        });

        await newProduct.save();
        existingProduct = newProduct;
        productsAffected++;
        details.push(`[CREATED] Product: ${newProduct.title} (${newProduct.slug})`);

        // SKU registry for standalone product
        if (pDef.sku) {
          await SkuRegistryModel.findOneAndUpdate(
            { normalizedSku: pDef.sku.toUpperCase() },
            {
              $set: {
                sku: pDef.sku,
                normalizedSku: pDef.sku.toUpperCase(),
                entityType: 'PRODUCT',
                entityId: newProduct._id,
                productId: newProduct._id,
                status: 'ASSIGNED',
              },
            },
            { upsert: true, new: true, setDefaultsOnInsert: true },
          );
          skuRegistryRecordsAffected++;
        }
      }
    } else {
      details.push(`[REUSED EXISTING] Product: ${existingProduct.title}`);
    }

    const currentProductId = existingProduct?._id || new mongoose.Types.ObjectId();

    // 5A. Standalone Product Pricing and Availability
    if (!pDef.hasVariants) {
      // 1. Global Standalone Pricing
      if (isDryRun) {
        details.push(
          `  [PROPOSED INSERT/UPSERT] STANDALONE_GLOBAL Pricing: B2C ₹${(pDef.globalB2cPricePaise! / 100).toFixed(2)}, MRP ₹${(pDef.globalB2cMrpPaise! / 100).toFixed(2)}, B2B ₹${(pDef.globalB2bPricePaise! / 100).toFixed(2)} (${pDef.globalB2bTiers?.length || 0} slabs)`,
        );
        pricingRecordsAffected++;
      } else {
        await ProductPricingModel.findOneAndUpdate(
          { productId: currentProductId, pricingScope: 'STANDALONE_GLOBAL' },
          {
            $set: {
              productId: currentProductId,
              variantId: null,
              serviceAreaId: null,
              pricingScope: 'STANDALONE_GLOBAL',
              currency: 'INR',
              b2cPricePaise: pDef.globalB2cPricePaise!,
              b2cMrpPaise: pDef.globalB2cMrpPaise!,
              b2bPricePaise: pDef.globalB2bPricePaise ?? null,
              b2bTiers: pDef.globalB2bTiers || [],
              isActive: true,
              createdBy: effectiveUserId,
              updatedBy: effectiveUserId,
            },
          },
          { upsert: true, new: true, setDefaultsOnInsert: true },
        );
        pricingRecordsAffected++;
      }

      // 2. Regional Standalone Pricing Override (if configured)
      if (pDef.regionalB2cPricePaise) {
        if (isDryRun) {
          details.push(
            `  [PROPOSED INSERT/UPSERT] STANDALONE_REGIONAL Override (${DEMO_SERVICE_AREA_CODE}): B2C ₹${(pDef.regionalB2cPricePaise / 100).toFixed(2)}, B2B ₹${((pDef.regionalB2bPricePaise || 0) / 100).toFixed(2)}`,
          );
          pricingRecordsAffected++;
        } else {
          await ProductPricingModel.findOneAndUpdate(
            {
              productId: currentProductId,
              serviceAreaId: centralAreaId,
              pricingScope: 'STANDALONE_REGIONAL',
            },
            {
              $set: {
                productId: currentProductId,
                variantId: null,
                serviceAreaId: centralAreaId,
                pricingScope: 'STANDALONE_REGIONAL',
                currency: 'INR',
                b2cPricePaise: pDef.regionalB2cPricePaise,
                b2cMrpPaise: pDef.regionalB2cMrpPaise ?? null,
                b2bPricePaise: pDef.regionalB2bPricePaise ?? null,
                b2bTiers: pDef.regionalB2bTiers || [],
                isActive: true,
                createdBy: effectiveUserId,
                updatedBy: effectiveUserId,
              },
            },
            { upsert: true, new: true, setDefaultsOnInsert: true },
          );
          pricingRecordsAffected++;
        }
      }

      // 3. Standalone Partner Stock Availability in BLR-CENTRAL
      if (pDef.isAvailableInCentral !== undefined) {
        if (isDryRun) {
          details.push(
            `  [PROPOSED INSERT/UPSERT] Partner Availability in ${DEMO_SERVICE_AREA_CODE}: available=${pDef.isAvailableInCentral}, leadTime=${pDef.minLeadTimeHours}h`,
          );
          availabilityRecordsAffected++;
        } else {
          await PartnerProductModel.findOneAndUpdate(
            {
              partnerId: effectivePartnerId,
              productId: currentProductId,
              serviceAreaId: centralAreaId,
              variantId: null,
            },
            {
              $set: {
                partnerId: effectivePartnerId,
                productId: currentProductId,
                variantId: null,
                serviceAreaId: centralAreaId,
                isAvailable: pDef.isAvailableInCentral,
                minLeadTimeHours: pDef.minLeadTimeHours ?? 24,
                createdBy: effectiveUserId,
                updatedBy: effectiveUserId,
              },
            },
            { upsert: true, new: true, setDefaultsOnInsert: true },
          );
          availabilityRecordsAffected++;
        }
      }
    }

    // 5B. Multi-Variant Product Variants, Pricing & Availability
    if (pDef.hasVariants && pDef.variants) {
      for (const vDef of pDef.variants) {
        // Collision check: verify no non-demo variant or SKU registry entry exists with this SKU
        const existingVar = await ProductVariantModel.findOne({ sku: vDef.sku });
        if (existingVar && !existingVar.sku.startsWith(DEMO_SKU_PREFIX)) {
          throw new Error(
            `Conflict: Existing non-demo variant found with SKU '${vDef.sku}'. Natural-key collision prevented.`,
          );
        }

        const existingVarSkuReg = await SkuRegistryModel.findOne({
          normalizedSku: vDef.sku.toUpperCase(),
        });
        if (existingVarSkuReg && !existingVarSkuReg.sku.startsWith(DEMO_SKU_PREFIX)) {
          throw new Error(
            `Conflict: Existing non-demo SKU Registry record found for variant '${vDef.sku}'. Natural-key collision prevented.`,
          );
        }

        let existingVariant = existingVar;

        if (!existingVariant) {
          if (isDryRun) {
            details.push(
              `  [PROPOSED INSERT] Variant: ${vDef.title} (${vDef.sku}) | Unit: ${vDef.unitCode} (prec: ${vDef.quantityPrecision})`,
            );
            variantsAffected++;
            skuRegistryRecordsAffected++;
          } else {
            const newVariant = new ProductVariantModel({
              productId: currentProductId,
              sku: vDef.sku,
              title: vDef.title,
              status: 'ACTIVE',
              attributes: vDef.attributes,
              images: vDef.images,
              unitCode: vDef.unitCode,
              quantityPrecision: vDef.quantityPrecision,
              minOrderQuantity: vDef.minOrderQuantity,
              stepIncrement: vDef.stepIncrement,
              publishedAt: new Date(),
            });

            await newVariant.save();
            existingVariant = newVariant;
            variantsAffected++;
            details.push(`  [CREATED] Variant: ${newVariant.title} (${newVariant.sku})`);

            // Sku Registry
            await SkuRegistryModel.findOneAndUpdate(
              { normalizedSku: vDef.sku.toUpperCase() },
              {
                $set: {
                  sku: vDef.sku,
                  normalizedSku: vDef.sku.toUpperCase(),
                  entityType: 'VARIANT',
                  entityId: newVariant._id,
                  productId: currentProductId,
                  status: 'ASSIGNED',
                },
              },
              { upsert: true, new: true, setDefaultsOnInsert: true },
            );
            skuRegistryRecordsAffected++;
          }
        } else {
          details.push(`  [REUSED EXISTING] Variant: ${existingVariant.title}`);
        }

        const currentVariantId = existingVariant?._id || new mongoose.Types.ObjectId();

        // Variant Global Pricing
        if (isDryRun) {
          details.push(
            `    [PROPOSED INSERT/UPSERT] VARIANT_GLOBAL Pricing: B2C ₹${(vDef.globalB2cPricePaise / 100).toFixed(2)}, B2B ₹${(vDef.globalB2bPricePaise / 100).toFixed(2)} (${vDef.globalB2bTiers?.length || 0} slabs)`,
          );
          pricingRecordsAffected++;
        } else {
          await ProductPricingModel.findOneAndUpdate(
            {
              productId: currentProductId,
              variantId: currentVariantId,
              pricingScope: 'VARIANT_GLOBAL',
            },
            {
              $set: {
                productId: currentProductId,
                variantId: currentVariantId,
                serviceAreaId: null,
                pricingScope: 'VARIANT_GLOBAL',
                currency: 'INR',
                b2cPricePaise: vDef.globalB2cPricePaise,
                b2cMrpPaise: vDef.globalB2cMrpPaise,
                b2bPricePaise: vDef.globalB2bPricePaise,
                b2bTiers: vDef.globalB2bTiers || [],
                isActive: true,
                createdBy: effectiveUserId,
                updatedBy: effectiveUserId,
              },
            },
            { upsert: true, new: true, setDefaultsOnInsert: true },
          );
          pricingRecordsAffected++;
        }

        // Variant Availability in BLR-CENTRAL
        if (vDef.isAvailableInCentral !== undefined) {
          if (isDryRun) {
            details.push(
              `    [PROPOSED INSERT/UPSERT] Partner Availability in ${DEMO_SERVICE_AREA_CODE}: available=${vDef.isAvailableInCentral}, leadTime=${vDef.minLeadTimeHours}h`,
            );
            availabilityRecordsAffected++;
          } else {
            await PartnerProductModel.findOneAndUpdate(
              {
                partnerId: effectivePartnerId,
                productId: currentProductId,
                variantId: currentVariantId,
                serviceAreaId: centralAreaId,
              },
              {
                $set: {
                  partnerId: effectivePartnerId,
                  productId: currentProductId,
                  variantId: currentVariantId,
                  serviceAreaId: centralAreaId,
                  isAvailable: vDef.isAvailableInCentral,
                  minLeadTimeHours: vDef.minLeadTimeHours,
                  createdBy: effectiveUserId,
                  updatedBy: effectiveUserId,
                },
              },
              { upsert: true, new: true, setDefaultsOnInsert: true },
            );
            availabilityRecordsAffected++;
          }
        }
      }
    }
  }

  const summary: IDemoSeedSummary = {
    mode: isDryRun ? 'DRY_RUN' : 'EXECUTE',
    usersAffected,
    partnersAffected,
    serviceAreasAffected,
    productsAffected,
    variantsAffected,
    pricingRecordsAffected,
    availabilityRecordsAffected,
    skuRegistryRecordsAffected,
    details,
  };

  logger.info(
    summary,
    isDryRun ? 'Demo seed dry-run preview complete' : 'Demo seed execution completed',
  );
  return summary;
}

/**
 * CLI Entrypoint
 */
export async function runCli(): Promise<void> {
  const args = process.argv.slice(2);
  const isConfirm = args.includes('--confirm');
  const isDryRun = args.includes('--dry-run') || !isConfirm;
  const isCleanup = args.includes('--cleanup');
  const isAllowRemoteDemoDb =
    args.includes('--allow-remote-demo-db') ||
    process.env.ALLOW_REMOTE_DEMO_DB === 'true' ||
    process.env.ALLOW_REMOTE_DEMO_DB === '1';

  console.log('================================================================');
  console.log('          THEHOMEZ GATE 3 DEMO DATA SEED SCRIPT               ');
  console.log('================================================================');

  // Validate target environment and display sanitized target info before database connection
  const parsedUri = assertSafeEnvironment({ allowRemoteDemoDb: isAllowRemoteDemoDb });
  console.log(`Target Database Host(s): ${parsedUri.hosts.join(', ')}`);
  console.log(`Target Database Name:    ${parsedUri.databaseName || '(default)'}`);
  console.log(`Sanitized Target URI:    ${parsedUri.sanitizedUri}`);
  console.log('----------------------------------------------------------------');

  if (isCleanup) {
    if (!isConfirm) {
      console.warn('WARNING: --cleanup specified without --confirm.');
      console.warn('To execute demo data cleanup, run with: --cleanup --confirm');
      process.exit(1);
    }
    await connectDatabase();
    try {
      const summary = await cleanupDemoData({
        confirm: isConfirm,
        allowRemoteDemoDb: isAllowRemoteDemoDb,
      });
      console.log('\n--- CLEANUP COMPLETE ---');
      summary.details.forEach((d) => console.log(` * ${d}`));
    } finally {
      await disconnectDatabase();
    }
    return;
  }

  if (isDryRun) {
    console.log('MODE: DRY-RUN (Preview Mode)');
    console.log('NOTE: Database writes are NOT performed in dry-run mode.');
    console.log('      To perform actual database writes, provide: --confirm\n');
  } else {
    console.log('MODE: EXECUTE (Database write confirmed)\n');
  }

  await connectDatabase();
  try {
    const summary = await seedDemoData({
      confirm: isConfirm,
      dryRun: isDryRun,
      allowRemoteDemoDb: isAllowRemoteDemoDb,
    });
    console.log('\n--- SUMMARY ---');
    console.log(`Mode:                          ${summary.mode}`);
    console.log(`Users affected:                ${summary.usersAffected}`);
    console.log(`Partners affected:             ${summary.partnersAffected}`);
    console.log(`Service Areas affected:        ${summary.serviceAreasAffected}`);
    console.log(`Products affected:             ${summary.productsAffected}`);
    console.log(`Variants affected:             ${summary.variantsAffected}`);
    console.log(`Pricing records affected:      ${summary.pricingRecordsAffected}`);
    console.log(`Availability records affected: ${summary.availabilityRecordsAffected}`);
    console.log(`SKU registry records:          ${summary.skuRegistryRecordsAffected}`);
    console.log('\n--- DETAILS ---');
    summary.details.forEach((d) => console.log(` * ${d}`));
  } finally {
    await disconnectDatabase();
  }
}

// Direct invocation check
if (process.argv[1] && process.argv[1].includes('seed-gate3-demo-data')) {
  runCli().catch((err) => {
    console.error('FATAL SEED ERROR:', err);
    process.exit(1);
  });
}
