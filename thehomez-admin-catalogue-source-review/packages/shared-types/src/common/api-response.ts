/**
 * Standard API Response Structures
 * Enforces uniform REST API response formats across all endpoints (SRS Section 3.2, 10.2).
 */
export interface IApiResponse<T = unknown> {
  success: true;
  data: T;
  meta?: {
    page?: number;
    limit?: number;
    total?: number;
    totalPages?: number;
    timestamp: string;
    correlationId?: string;
  };
}

export interface IApiErrorDetail {
  field?: string;
  message: string;
  code?: string;
}

export interface IApiErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
    details?: IApiErrorDetail[];
    correlationId?: string;
    timestamp: string;
  };
}
