import { useState } from 'react';
import { Alert, Button, Input, Space, Table, Typography } from 'antd';
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { MAX_VARIANT_ATTRIBUTES } from '@thehomez/shared-types';

export interface AttributeEditorProps {
  value?: Record<string, string>;
  onChange?: (attributes: Record<string, string>) => void;
  disabled?: boolean;
}

interface AttributeRow {
  key: string;
  value: string;
}

export function AttributeEditor({ value = {}, onChange, disabled = false }: AttributeEditorProps) {
  const [newKey, setNewKey] = useState('');
  const [newVal, setNewVal] = useState('');
  const [inputError, setInputError] = useState<string | null>(null);

  const entries: AttributeRow[] = Object.entries(value).map(([k, v]) => ({ key: k, value: v }));
  const count = entries.length;
  const atLimit = count >= MAX_VARIANT_ATTRIBUTES;
  const atMinimum = count <= 1;

  const handleAdd = () => {
    const trimmedKey = newKey.trim().toLowerCase();
    const trimmedVal = newVal.trim();

    if (!trimmedKey) {
      setInputError('Attribute key cannot be empty');
      return;
    }
    if (trimmedKey.length > 50) {
      setInputError('Attribute key cannot exceed 50 characters');
      return;
    }
    if (!trimmedVal) {
      setInputError('Attribute value cannot be empty');
      return;
    }
    if (trimmedVal.length > 200) {
      setInputError('Attribute value cannot exceed 200 characters');
      return;
    }

    // Check duplicate key (case-normalized)
    const duplicate = Object.keys(value).some((k) => k.toLowerCase() === trimmedKey);
    if (duplicate) {
      setInputError(`Attribute key "${trimmedKey}" already exists`);
      return;
    }

    if (count >= MAX_VARIANT_ATTRIBUTES) {
      setInputError(`Cannot exceed ${MAX_VARIANT_ATTRIBUTES} attributes`);
      return;
    }

    setInputError(null);
    setNewKey('');
    setNewVal('');
    onChange?.({ ...value, [trimmedKey]: trimmedVal });
  };

  const handleUpdateValue = (key: string, updatedVal: string) => {
    onChange?.({ ...value, [key]: updatedVal.trim() });
  };

  const handleRemove = (keyToRemove: string) => {
    if (entries.length <= 1) {
      return;
    }
    const next: Record<string, string> = {};
    for (const [k, v] of Object.entries(value)) {
      if (k !== keyToRemove) next[k] = v;
    }
    onChange?.(next);
  };

  return (
    <Space direction="vertical" size="small" style={{ width: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Typography.Text type="secondary">
          {count} / {MAX_VARIANT_ATTRIBUTES} attributes
        </Typography.Text>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          Minimum 1 attribute required · Keys normalized to lowercase
        </Typography.Text>
      </div>

      {!disabled && !atLimit && (
        <Space direction="vertical" size={4} style={{ width: '100%' }}>
          <Space style={{ width: '100%' }} align="start">
            <Input
              placeholder="Attribute Key (e.g. diameter, grade, size)"
              value={newKey}
              onChange={(e) => {
                setNewKey(e.target.value);
                if (inputError) setInputError(null);
              }}
              style={{ width: 220 }}
              disabled={disabled}
              aria-label="Attribute key input"
            />
            <Input
              placeholder="Attribute Value (e.g. 12mm, Fe550D)"
              value={newVal}
              onChange={(e) => {
                setNewVal(e.target.value);
                if (inputError) setInputError(null);
              }}
              style={{ flex: 1 }}
              disabled={disabled}
              onPressEnter={(e) => {
                e.preventDefault();
                handleAdd();
              }}
              aria-label="Attribute value input"
            />
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={handleAdd}
              disabled={disabled || !newKey.trim() || !newVal.trim()}
            >
              Add Attribute
            </Button>
          </Space>
          {inputError && <Typography.Text type="danger">{inputError}</Typography.Text>}
        </Space>
      )}

      {atLimit && (
        <Alert
          type="info"
          showIcon
          message={`Maximum limit of ${MAX_VARIANT_ATTRIBUTES} attributes reached.`}
        />
      )}

      {entries.length === 0 ? (
        <Alert
          type="warning"
          showIcon
          message="No attributes configured"
          description="At least one attribute is required for every variant."
        />
      ) : (
        <Table<AttributeRow>
          size="small"
          rowKey="key"
          dataSource={entries}
          pagination={false}
          columns={[
            {
              title: 'Attribute Key',
              dataIndex: 'key',
              key: 'key',
              width: 220,
              render: (key: string) => <Typography.Text strong>{key}</Typography.Text>,
            },
            {
              title: 'Value',
              dataIndex: 'value',
              key: 'value',
              render: (val: string, record) =>
                disabled ? (
                  <span>{val}</span>
                ) : (
                  <Input
                    value={val}
                    maxLength={200}
                    onChange={(e) => handleUpdateValue(record.key, e.target.value)}
                    aria-label={`Edit value for ${record.key}`}
                  />
                ),
            },
            ...(!disabled
              ? [
                  {
                    title: 'Action',
                    key: 'action',
                    width: 80,
                    render: (_: unknown, record: AttributeRow) => (
                      <Button
                        type="text"
                        danger
                        icon={<DeleteOutlined />}
                        disabled={atMinimum}
                        onClick={() => handleRemove(record.key)}
                        aria-label={
                          atMinimum
                            ? 'Cannot remove the only attribute'
                            : `Remove attribute ${record.key}`
                        }
                      />
                    ),
                  },
                ]
              : []),
          ]}
        />
      )}
    </Space>
  );
}
