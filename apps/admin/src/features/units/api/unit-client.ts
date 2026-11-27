import type {
  IUnit,
  ICreateUnitDto,
  IUpdateUnitDto,
  IUnitConversionRate,
  UnitClassification,
} from '@thehomez/shared-types';
import { apiRequest } from '../../../services/api-client.js';

export interface UnitListQuery {
  classification?: UnitClassification;
  activeOnly?: boolean;
  search?: string;
  signal?: AbortSignal;
}

export const unitClient = {
  list(query: UnitListQuery = {}): Promise<IUnit[]> {
    const params = new URLSearchParams();
    if (query.classification) params.set('classification', query.classification);
    params.set('activeOnly', String(query.activeOnly ?? true));
    if (query.search && query.search.trim().length > 0) {
      params.set('search', query.search.trim());
    }
    const suffix = `?${params.toString()}`;
    return apiRequest(`/units${suffix}`, { method: 'GET', signal: query.signal });
  },

  getByCode(code: string, options: { signal?: AbortSignal } = {}): Promise<IUnit> {
    return apiRequest(`/units/${encodeURIComponent(code)}`, {
      method: 'GET',
      signal: options.signal,
    });
  },

  create(dto: ICreateUnitDto): Promise<IUnit> {
    return apiRequest('/units', {
      method: 'POST',
      body: JSON.stringify(dto),
    });
  },

  update(code: string, dto: IUpdateUnitDto): Promise<IUnit> {
    return apiRequest(`/units/${encodeURIComponent(code)}`, {
      method: 'PATCH',
      body: JSON.stringify(dto),
    });
  },

  updateStatus(code: string, isActive: boolean): Promise<IUnit> {
    return this.update(code, { isActive });
  },

  listConversions(options: { signal?: AbortSignal } = {}): Promise<IUnitConversionRate[]> {
    return apiRequest('/units/conversions', {
      method: 'GET',
      signal: options.signal,
    });
  },
};
