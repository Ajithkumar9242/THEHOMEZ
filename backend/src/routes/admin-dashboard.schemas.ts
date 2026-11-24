import { z } from 'zod';
import { DASHBOARD_DATE_RANGES } from '@thehomez/shared-types';

export const adminDashboardQuerySchema = z
  .object({
    dateRange: z.enum(DASHBOARD_DATE_RANGES).default('30d'),
    startDate: z.string().datetime().optional(),
    endDate: z.string().datetime().optional(),
  })
  .strict();

export const adminDashboardLimitQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(50).default(10),
  })
  .strict();

export type AdminDashboardQueryInput = z.infer<typeof adminDashboardQuerySchema>;
export type AdminDashboardLimitQueryInput = z.infer<typeof adminDashboardLimitQuerySchema>;
