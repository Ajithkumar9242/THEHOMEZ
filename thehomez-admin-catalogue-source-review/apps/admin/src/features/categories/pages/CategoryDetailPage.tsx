import { useEffect, useState } from 'react';
import { Alert, Button, Empty, Result, Skeleton, Space, Typography } from 'antd';
import { ArrowLeftOutlined, ReloadOutlined } from '@ant-design/icons';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import type { ICategoryDetailsResponse } from '@thehomez/shared-types';
import { ApiError } from '../../../services/api-client.js';
import { categoryClient } from '../api/category-client.js';
import { CategoryDetails } from '../components/CategoryDetails.js';

function describeError(error: unknown): { status: number; message: string; permission: boolean } {
  if (error instanceof ApiError) {
    if (error.status === 403)
      return {
        status: 403,
        message: 'Your staff account does not have permission to view this category.',
        permission: true,
      };
    if (error.status === 404)
      return {
        status: 404,
        message: 'This category is not available in the current view.',
        permission: false,
      };
    if (error.status === 400 || error.status === 422)
      return { status: error.status, message: error.message, permission: false };
    if (error.status === 401)
      return {
        status: 401,
        message: 'Your session has expired. Sign in again.',
        permission: false,
      };
    return {
      status: error.status,
      message:
        error.status >= 500 || error.status === 0
          ? 'The service is temporarily unavailable. Try again.'
          : error.message,
      permission: false,
    };
  }
  return {
    status: 500,
    message: 'The category could not be loaded. Try again.',
    permission: false,
  };
}

export function CategoryDetailPage() {
  const { slug = '' } = useParams();
  const [searchParams] = useSearchParams();
  const includeInactive = searchParams.get('includeInactive') === 'true';
  const navigate = useNavigate();
  const [details, setDetails] = useState<ICategoryDetailsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    void categoryClient
      .getDetails(slug, { includeInactive, signal: controller.signal })
      .then((result) => {
        if (!controller.signal.aborted) setDetails(result);
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(reason);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [slug, includeInactive, attempt]);

  const errorView = error ? describeError(error) : null;
  return (
    <div className="category-detail-page">
      <Button
        type="text"
        icon={<ArrowLeftOutlined />}
        onClick={() =>
          navigate(`/catalogue/categories${includeInactive ? '?includeInactive=true' : ''}`)
        }
      >
        Back to categories
      </Button>
      <div className="category-detail-heading">
        <Typography.Text className="eyebrow">CATEGORY DETAILS</Typography.Text>
        <Typography.Title level={1}>{details?.category.name || 'Category'}</Typography.Title>
      </div>
      {loading ? (
        <Skeleton active paragraph={{ rows: 6 }} />
      ) : errorView ? (
        errorView.status === 403 ? (
          <Result status="403" title="Permission denied" subTitle={errorView.message} />
        ) : errorView.status === 404 ? (
          <Result
            status="404"
            title="Category not found"
            subTitle={errorView.message}
            extra={
              <Button
                onClick={() =>
                  navigate(`/catalogue/categories${includeInactive ? '?includeInactive=true' : ''}`)
                }
              >
                Return to categories
              </Button>
            }
          />
        ) : (
          <Alert
            type={errorView.status === 401 ? 'error' : 'warning'}
            showIcon
            role="alert"
            message={
              errorView.status === 401
                ? 'Session expired'
                : errorView.status === 400 || errorView.status === 422
                  ? 'Invalid request'
                  : 'Category details unavailable'
            }
            description={errorView.message}
            action={
              <Space>
                {errorView.status === 401 && (
                  <Button type="link" onClick={() => navigate('/sign-in')}>
                    Sign in
                  </Button>
                )}
                <Button icon={<ReloadOutlined />} onClick={() => setAttempt((value) => value + 1)}>
                  Retry
                </Button>
              </Space>
            }
          />
        )
      ) : details ? (
        <CategoryDetails details={details} />
      ) : (
        <Empty description="No category details returned" />
      )}
    </div>
  );
}
