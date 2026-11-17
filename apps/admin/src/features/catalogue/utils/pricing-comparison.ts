import type { IB2BVolumeTier, MoneyPaise } from '@thehomez/shared-types';

export type PriceDirection = 'HIGHER' | 'LOWER' | 'EQUAL';

export interface PriceComparison {
  hasComparison: boolean;
  regionalPaise: MoneyPaise | null;
  globalPaise: MoneyPaise | null;
  diffPaise: number | null;
  absDiffPaise: number | null;
  direction: PriceDirection | null;
  diffFormatted: string | null;
  label: string;
}

const integerRupees = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });

/** Formats an exact integer-paise amount without converting paise through floating point. */
export function formatPaiseExact(value: number | null | undefined): string {
  if (value == null || !Number.isSafeInteger(value) || value < 0) return '—';
  const paise = BigInt(value);
  const rupees = paise / 100n;
  const fraction = String(paise % 100n).padStart(2, '0');
  return `₹${integerRupees.format(Number(rupees))}.${fraction}`;
}

/**
 * Calculates exact integer-paise difference between regional price and global price.
 * Uses exact BigInt/integer arithmetic to avoid floating point drift.
 */
export function comparePricePaise(
  regionalPaise: number | null | undefined,
  globalPaise: number | null | undefined,
): PriceComparison {
  const isRegionalValid =
    regionalPaise !== null &&
    regionalPaise !== undefined &&
    Number.isSafeInteger(regionalPaise) &&
    regionalPaise >= 0;
  const isGlobalValid =
    globalPaise !== null &&
    globalPaise !== undefined &&
    Number.isSafeInteger(globalPaise) &&
    globalPaise >= 0;

  if (!isRegionalValid && !isGlobalValid) {
    return {
      hasComparison: false,
      regionalPaise: null,
      globalPaise: null,
      diffPaise: null,
      absDiffPaise: null,
      direction: null,
      diffFormatted: null,
      label: 'Not configured',
    };
  }

  if (!isGlobalValid) {
    return {
      hasComparison: false,
      regionalPaise: (regionalPaise as MoneyPaise) ?? null,
      globalPaise: null,
      diffPaise: null,
      absDiffPaise: null,
      direction: null,
      diffFormatted: null,
      label: 'Global baseline not configured',
    };
  }

  if (!isRegionalValid) {
    return {
      hasComparison: false,
      regionalPaise: null,
      globalPaise: (globalPaise as MoneyPaise) ?? null,
      diffPaise: null,
      absDiffPaise: null,
      direction: null,
      diffFormatted: null,
      label: 'Regional value not configured',
    };
  }

  const reg = BigInt(regionalPaise);
  const glob = BigInt(globalPaise);
  const diffBigInt = reg - glob;
  const diffNumber = Number(diffBigInt);
  const absDiff = Math.abs(diffNumber);
  const absFormatted = formatPaiseExact(absDiff);

  if (diffNumber > 0) {
    return {
      hasComparison: true,
      regionalPaise: regionalPaise as MoneyPaise,
      globalPaise: globalPaise as MoneyPaise,
      diffPaise: diffNumber,
      absDiffPaise: absDiff,
      direction: 'HIGHER',
      diffFormatted: `+${absFormatted}`,
      label: `${absFormatted} higher than global`,
    };
  }

  if (diffNumber < 0) {
    return {
      hasComparison: true,
      regionalPaise: regionalPaise as MoneyPaise,
      globalPaise: globalPaise as MoneyPaise,
      diffPaise: diffNumber,
      absDiffPaise: absDiff,
      direction: 'LOWER',
      diffFormatted: `-${absFormatted}`,
      label: `${absFormatted} lower than global`,
    };
  }

  return {
    hasComparison: true,
    regionalPaise: regionalPaise as MoneyPaise,
    globalPaise: globalPaise as MoneyPaise,
    diffPaise: 0,
    absDiffPaise: 0,
    direction: 'EQUAL',
    diffFormatted: '₹0.00',
    label: 'Same as global baseline',
  };
}

export type TierComparisonStatus = 'MATCHED' | 'REGIONAL_ONLY' | 'GLOBAL_ONLY';

export interface TierComparisonRow {
  minQuantity: string;
  regionalPricePaise: MoneyPaise | null;
  globalPricePaise: MoneyPaise | null;
  comparison: PriceComparison | null;
  status: TierComparisonStatus;
}

export interface VolumeTiersComparison {
  hasRegionalTiers: boolean;
  hasGlobalTiers: boolean;
  rows: TierComparisonRow[];
  summaryMessage: string;
}

/**
 * Compares regional volume tiers against global baseline volume tiers.
 * Explicitly distinguishes matched slabs, regional-only custom slabs, and global tiers not offered in this region.
 * Never implies that missing regional tiers inherit global tiers.
 */
export function compareVolumeTiers(
  regionalTiers: IB2BVolumeTier[] = [],
  globalTiers: IB2BVolumeTier[] = [],
): VolumeTiersComparison {
  const hasRegionalTiers = regionalTiers.length > 0;
  const hasGlobalTiers = globalTiers.length > 0;

  if (!hasRegionalTiers && !hasGlobalTiers) {
    return {
      hasRegionalTiers: false,
      hasGlobalTiers: false,
      rows: [],
      summaryMessage:
        'No volume discount tiers configured for either global or regional schedules.',
    };
  }

  if (!hasRegionalTiers && hasGlobalTiers) {
    return {
      hasRegionalTiers: false,
      hasGlobalTiers: true,
      rows: globalTiers.map((tier) => ({
        minQuantity: tier.minQuantity,
        regionalPricePaise: null,
        globalPricePaise: tier.pricePaise,
        comparison: null,
        status: 'GLOBAL_ONLY',
      })),
      summaryMessage:
        'No regional volume tiers configured. Contractors in this service area do not receive bulk volume discounts (global tiers are not inherited).',
    };
  }

  if (hasRegionalTiers && !hasGlobalTiers) {
    return {
      hasRegionalTiers: true,
      hasGlobalTiers: false,
      rows: regionalTiers.map((tier) => ({
        minQuantity: tier.minQuantity,
        regionalPricePaise: tier.pricePaise,
        globalPricePaise: null,
        comparison: null,
        status: 'REGIONAL_ONLY',
      })),
      summaryMessage:
        'Custom regional volume tiers apply in this service area (global baseline has no volume tiers).',
    };
  }

  // Both have tiers: union quantities, starting with regional order, then remaining global
  const regionalMap = new Map(regionalTiers.map((t) => [t.minQuantity, t.pricePaise]));
  const globalMap = new Map(globalTiers.map((t) => [t.minQuantity, t.pricePaise]));

  const allQuantities: string[] = [];
  for (const t of regionalTiers) {
    allQuantities.push(t.minQuantity);
  }
  for (const t of globalTiers) {
    if (!regionalMap.has(t.minQuantity)) {
      allQuantities.push(t.minQuantity);
    }
  }

  const rows: TierComparisonRow[] = allQuantities.map((minQuantity) => {
    const regPrice = regionalMap.get(minQuantity) ?? null;
    const globPrice = globalMap.get(minQuantity) ?? null;

    if (regPrice !== null && globPrice !== null) {
      return {
        minQuantity,
        regionalPricePaise: regPrice,
        globalPricePaise: globPrice,
        comparison: comparePricePaise(regPrice, globPrice),
        status: 'MATCHED',
      };
    }

    if (regPrice !== null) {
      return {
        minQuantity,
        regionalPricePaise: regPrice,
        globalPricePaise: null,
        comparison: null,
        status: 'REGIONAL_ONLY',
      };
    }

    return {
      minQuantity,
      regionalPricePaise: null,
      globalPricePaise: globPrice,
      comparison: null,
      status: 'GLOBAL_ONLY',
    };
  });

  return {
    hasRegionalTiers: true,
    hasGlobalTiers: true,
    rows,
    summaryMessage:
      'Regional volume tiers compared against global baseline tiers. Zero inheritance: only configured regional slabs apply.',
  };
}
