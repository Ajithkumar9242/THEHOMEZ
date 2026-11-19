import { Tag } from 'antd';

interface PartnerDeliveryModeBadgeProps {
  deliveryMode: 'PARTNER_MANAGED' | 'PLATFORM_MANAGED';
  style?: React.CSSProperties;
}

export function PartnerDeliveryModeBadge({ deliveryMode, style }: PartnerDeliveryModeBadgeProps) {
  const isPartner = deliveryMode === 'PARTNER_MANAGED';

  return (
    <Tag
      color={isPartner ? 'blue' : 'purple'}
      style={style}
      aria-label={`Delivery Mode: ${isPartner ? 'Partner Managed' : 'Platform Managed'}`}
    >
      {isPartner ? 'Partner Managed' : 'Platform Managed'}
    </Tag>
  );
}
