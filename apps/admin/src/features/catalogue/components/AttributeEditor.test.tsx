import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { AttributeEditor } from './AttributeEditor.js';

afterEach(() => {
  vi.clearAllMocks();
});

describe('AttributeEditor component', () => {
  it('renders initial attributes correctly', () => {
    const initial = { diameter: '12mm', grade: 'Fe550D' };
    render(<AttributeEditor value={initial} />);

    expect(screen.getByText('2 / 20 attributes')).toBeInTheDocument();
    expect(screen.getByText('diameter')).toBeInTheDocument();
    expect(screen.getByDisplayValue('12mm')).toBeInTheDocument();
    expect(screen.getByText('grade')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Fe550D')).toBeInTheDocument();
  });

  it('adds an attribute with trimmed values and lowercase normalized keys', () => {
    const handleChange = vi.fn();
    render(<AttributeEditor value={{ diameter: '12mm' }} onChange={handleChange} />);

    const keyInput = screen.getByLabelText('Attribute key input');
    const valInput = screen.getByLabelText('Attribute value input');
    const addButton = screen.getByRole('button', { name: /Add Attribute/i });

    fireEvent.change(keyInput, { target: { value: '  GRADE  ' } });
    fireEvent.change(valInput, { target: { value: '  Fe550D  ' } });
    fireEvent.click(addButton);

    expect(handleChange).toHaveBeenCalledWith({
      diameter: '12mm',
      grade: 'Fe550D',
    });
  });

  it('removes an attribute when more than 1 attribute exists', () => {
    const handleChange = vi.fn();
    render(
      <AttributeEditor value={{ diameter: '12mm', grade: 'Fe550D' }} onChange={handleChange} />,
    );

    const removeDiameterBtn = screen.getByLabelText('Remove attribute diameter');
    expect(removeDiameterBtn).not.toBeDisabled();

    fireEvent.click(removeDiameterBtn);

    expect(handleChange).toHaveBeenCalledWith({
      grade: 'Fe550D',
    });
  });

  it('enforces minimum one-attribute restriction by disabling delete on the only attribute', () => {
    const handleChange = vi.fn();
    render(<AttributeEditor value={{ diameter: '12mm' }} onChange={handleChange} />);

    const removeBtn = screen.getByLabelText('Cannot remove the only attribute');
    expect(removeBtn).toBeDisabled();

    fireEvent.click(removeBtn);
    expect(handleChange).not.toHaveBeenCalled();
  });

  it('validates against empty key and empty value', () => {
    const handleChange = vi.fn();
    render(<AttributeEditor value={{ diameter: '12mm' }} onChange={handleChange} />);

    const keyInput = screen.getByLabelText('Attribute key input');
    const valInput = screen.getByLabelText('Attribute value input');
    const addButton = screen.getByRole('button', { name: /Add Attribute/i });

    // Empty key test
    fireEvent.change(keyInput, { target: { value: '   ' } });
    fireEvent.change(valInput, { target: { value: 'test' } });
    fireEvent.click(addButton);
    // Button is disabled when key is blank
    expect(addButton).toBeDisabled();
    expect(handleChange).not.toHaveBeenCalled();

    // Empty value test
    fireEvent.change(keyInput, { target: { value: 'color' } });
    fireEvent.change(valInput, { target: { value: '   ' } });
    expect(addButton).toBeDisabled();
    expect(handleChange).not.toHaveBeenCalled();
  });

  it('enforces key length limit (max 50 characters)', () => {
    const handleChange = vi.fn();
    render(<AttributeEditor value={{ diameter: '12mm' }} onChange={handleChange} />);

    const keyInput = screen.getByLabelText('Attribute key input');
    const valInput = screen.getByLabelText('Attribute value input');
    const addButton = screen.getByRole('button', { name: /Add Attribute/i });

    fireEvent.change(keyInput, { target: { value: 'k'.repeat(51) } });
    fireEvent.change(valInput, { target: { value: 'valid-val' } });
    fireEvent.click(addButton);

    expect(screen.getByText('Attribute key cannot exceed 50 characters')).toBeInTheDocument();
    expect(handleChange).not.toHaveBeenCalled();
  });

  it('enforces value length limit (max 200 characters)', () => {
    const handleChange = vi.fn();
    render(<AttributeEditor value={{ diameter: '12mm' }} onChange={handleChange} />);

    const keyInput = screen.getByLabelText('Attribute key input');
    const valInput = screen.getByLabelText('Attribute value input');
    const addButton = screen.getByRole('button', { name: /Add Attribute/i });

    fireEvent.change(keyInput, { target: { value: 'finish' } });
    fireEvent.change(valInput, { target: { value: 'v'.repeat(205) } });
    fireEvent.click(addButton);

    expect(screen.getByText('Attribute value cannot exceed 200 characters')).toBeInTheDocument();
    expect(handleChange).not.toHaveBeenCalled();
  });

  it('prevents duplicate keys after case normalization', () => {
    const handleChange = vi.fn();
    render(<AttributeEditor value={{ diameter: '12mm' }} onChange={handleChange} />);

    const keyInput = screen.getByLabelText('Attribute key input');
    const valInput = screen.getByLabelText('Attribute value input');
    const addButton = screen.getByRole('button', { name: /Add Attribute/i });

    // Try adding 'DIAMETER' with different casing
    fireEvent.change(keyInput, { target: { value: 'DIAMETER' } });
    fireEvent.change(valInput, { target: { value: '16mm' } });
    fireEvent.click(addButton);

    expect(screen.getByText('Attribute key "diameter" already exists')).toBeInTheDocument();
    expect(handleChange).not.toHaveBeenCalled();
  });

  it('enforces maximum 20-attribute restriction', () => {
    const twentyAttrs = Object.fromEntries(
      Array.from({ length: 20 }, (_, i) => [`attr${i}`, `val${i}`]),
    );

    render(<AttributeEditor value={twentyAttrs} />);

    expect(screen.getByText('20 / 20 attributes')).toBeInTheDocument();
    expect(screen.getByText(/Maximum limit of 20 attributes reached/i)).toBeInTheDocument();
    expect(screen.queryByLabelText('Attribute key input')).not.toBeInTheDocument();
  });

  it('allows inline editing of existing attribute values', () => {
    const handleChange = vi.fn();
    render(<AttributeEditor value={{ diameter: '12mm' }} onChange={handleChange} />);

    const valueInput = screen.getByLabelText('Edit value for diameter');
    fireEvent.change(valueInput, { target: { value: '16mm' } });

    expect(handleChange).toHaveBeenCalledWith({
      diameter: '16mm',
    });
  });

  it('displays warning when value is empty', () => {
    render(<AttributeEditor value={{}} />);

    expect(screen.getByText('No attributes configured')).toBeInTheDocument();
    expect(
      screen.getByText('At least one attribute is required for every variant.'),
    ).toBeInTheDocument();
  });
});
