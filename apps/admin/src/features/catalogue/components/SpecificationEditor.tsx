import { useState } from 'react';
import { Alert, Button, Input, Space, Table, Typography } from 'antd';
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import {
  MAX_SPECIFICATION_KEYS,
  MAX_SPECIFICATION_VALUE_LENGTH,
  SPECIFICATION_KEY_REGEX,
} from '@thehomez/shared-types';

export interface SpecificationEditorProps {
  value?: Record<string, string>;
  onChange?: (specs: Record<string, string>) => void;
  disabled?: boolean;
}

interface SpecRow {
  key: string;
  value: string;
}

export function SpecificationEditor({
  value = {},
  onChange,
  disabled = false,
}: SpecificationEditorProps) {
  const [newKey, setNewKey] = useState('');
  const [newVal, setNewVal] = useState('');
  const [inputError, setInputError] = useState<string | null>(null);

  const entries: SpecRow[] = Object.entries(value).map(([k, v]) => ({ key: k, value: v }));
  const count = entries.length;
  const atLimit = count >= MAX_SPECIFICATION_KEYS;

  const handleAdd = () => {
    const trimmedKey = newKey.trim();
    const trimmedVal = newVal.trim();

    if (!trimmedKey) {
      setInputError('Specification key cannot be empty');
      return;
    }
    if (!SPECIFICATION_KEY_REGEX.test(trimmedKey)) {
      setInputError(
        'Key must be 1–50 characters and contain only letters, numbers, hyphens, and underscores',
      );
      return;
    }
    if (!trimmedVal) {
      setInputError('Specification value cannot be empty');
      return;
    }
    if (trimmedVal.length > MAX_SPECIFICATION_VALUE_LENGTH) {
      setInputError(`Value cannot exceed ${MAX_SPECIFICATION_VALUE_LENGTH} characters`);
      return;
    }

    // Check duplicate key (case-insensitive normalization)
    const normalizedKey = trimmedKey.toLowerCase();
    const duplicate = Object.keys(value).some((k) => k.toLowerCase() === normalizedKey);
    if (duplicate) {
      setInputError(`Specification key "${trimmedKey}" already exists (keys are case-insensitive)`);
      return;
    }

    if (count >= MAX_SPECIFICATION_KEYS) {
      setInputError(`Cannot exceed ${MAX_SPECIFICATION_KEYS} specifications`);
      return;
    }

    setInputError(null);
    setNewKey('');
    setNewVal('');
    onChange?.({ ...value, [trimmedKey]: trimmedVal });
  };

  const handleUpdateValue = (key: string, updatedVal: string) => {
    onChange?.({ ...value, [key]: updatedVal });
  };

  const handleRemove = (keyToRemove: string) => {
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
          {count} / {MAX_SPECIFICATION_KEYS} specifications
        </Typography.Text>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          Max {MAX_SPECIFICATION_VALUE_LENGTH} chars per value
        </Typography.Text>
      </div>

      {!disabled && !atLimit && (
        <Space direction="vertical" size={4} style={{ width: '100%' }}>
          <Space style={{ width: '100%' }} align="start">
            <Input
              placeholder="Key (e.g. Grade, Finish, Color)"
              value={newKey}
              onChange={(e) => {
                setNewKey(e.target.value);
                if (inputError) setInputError(null);
              }}
              style={{ width: 200 }}
              disabled={disabled}
              aria-label="Specification key input"
            />
            <Input
              placeholder="Value (e.g. Fe 550D, Matte)"
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
              aria-label="Specification value input"
            />
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={handleAdd}
              disabled={disabled || !newKey.trim() || !newVal.trim()}
            >
              Add
            </Button>
          </Space>
          {inputError && <Typography.Text type="danger">{inputError}</Typography.Text>}
        </Space>
      )}

      {atLimit && (
        <Alert
          type="info"
          showIcon
          message={`Maximum limit of ${MAX_SPECIFICATION_KEYS} specifications reached.`}
        />
      )}

      {entries.length === 0 ? (
        <Typography.Text type="secondary" italic>
          No specifications defined.
        </Typography.Text>
      ) : (
        <Table<SpecRow>
          size="small"
          rowKey="key"
          dataSource={entries}
          pagination={false}
          columns={[
            {
              title: 'Key',
              dataIndex: 'key',
              key: 'key',
              width: 180,
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
                    maxLength={MAX_SPECIFICATION_VALUE_LENGTH}
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
                    render: (_: unknown, record: SpecRow) => (
                      <Button
                        type="text"
                        danger
                        icon={<DeleteOutlined />}
                        onClick={() => handleRemove(record.key)}
                        aria-label={`Delete specification ${record.key}`}
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
