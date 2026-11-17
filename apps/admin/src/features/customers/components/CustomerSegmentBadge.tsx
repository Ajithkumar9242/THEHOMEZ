import { Tag } from 'antd';

interface CustomerSegmentBadgeProps {
  segment: 'B2B' | 'B2C' | string;
}

export function CustomerSegmentBadge({ segment }: CustomerSegmentBadgeProps) {
  if (segment === 'B2B') {
    return (
      <Tag color="purple" aria-label="Segment: B2B Wholesale">
        B2B Wholesale
      </Tag>
    );
  }

  if (segment === 'B2C') {
    return (
      <Tag color="blue" aria-label="Segment: B2C Retail">
        B2C Retail
      </Tag>
    );
  }

  return <Tag aria-label={`Segment: ${segment}`}>{segment || '—'}</Tag>;
}
