import { useState } from 'react';
import { Alert, Modal, Typography } from 'antd';
import type { IUnit } from '@thehomez/shared-types';
import { ApiError } from '../../../services/api-client.js';
import { unitClient } from '../api/unit-client.js';

export interface UnitStatusModalProps {
  open: boolean;
  unit: IUnit | null;
  targetActive: boolean;
  onClose: () => void;
  onSuccess: (updatedUnit: IUnit) => void;
}

export function UnitStatusModal({
  open,
  unit,
  targetActive,
  onClose,
  onSuccess,
}: UnitStatusModalProps) {
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (!unit) return null;

  const handleConfirm = async () => {
    setSubmitting(true);
    setErrorMsg(null);

    try {
      const updated = await unitClient.updateStatus(unit.code, targetActive);
      onSuccess(updated);
      onClose();
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        if (err.code === 'UNIT_IN_USE_BY_ACTIVE_PRODUCTS') {
          setErrorMsg(
            `Unit "${unit.code}" cannot be deactivated because it is currently in use by active or published products or variants. Deactivate or reassign referenced products before deactivating this unit.`,
          );
        } else {
          setErrorMsg(err.message || 'Failed to update unit status.');
        }
      } else if (err instanceof Error) {
        setErrorMsg(err.message);
      } else {
        setErrorMsg('An unexpected error occurred.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      title={targetActive ? `Activate Unit: ${unit.code}` : `Deactivate Unit: ${unit.code}`}
      open={open}
      onOk={handleConfirm}
      onCancel={() => {
        setErrorMsg(null);
        onClose();
      }}
      confirmLoading={submitting}
      okText={targetActive ? 'Activate Unit' : 'Deactivate Unit'}
      okButtonProps={{ danger: !targetActive }}
    >
      {errorMsg && (
        <Alert
          type="error"
          showIcon
          message="Status Transition Blocked"
          description={errorMsg}
          style={{ marginBottom: 16 }}
        />
      )}

      {targetActive ? (
        <Typography.Paragraph>
          Are you sure you want to activate <strong>{unit.name} ({unit.code})</strong>?
          Once active, it will be immediately available for selection in product and variant configurations.
        </Typography.Paragraph>
      ) : (
        <>
          <Typography.Paragraph>
            Are you sure you want to deactivate <strong>{unit.name} ({unit.code})</strong>?
          </Typography.Paragraph>
          <Alert
            type="warning"
            showIcon
            message="Catalogue Integrity Guard"
            description="Inactive units cannot be assigned to new products or variants. The backend strictly prevents deactivating any unit that is currently in use by active or published catalogue items."
          />
        </>
      )}
    </Modal>
  );
}
