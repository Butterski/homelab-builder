import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrandIcon } from './brand-icon';
import { IconPicker } from './icon-picker';

function ControlledPicker() {
  const [value, setValue] = useState<string | undefined>('proxmox');
  return (
    <IconPicker
      value={value}
      onChange={setValue}
    />
  );
}

describe('BrandIcon', () => {
  it('renders a known brand with an accessible name and same-origin artwork', () => {
    render(<BrandIcon icon="docker" fallback={<span>Generic device</span>} />);
    expect(screen.getByRole('img', { name: 'Docker' })).toHaveAttribute('src', '/brand-icons/docker.svg');
    expect(screen.queryByText('Generic device')).not.toBeInTheDocument();
  });

  it.each(['unknown-brand', '__proto__', 'https://example.com/logo.svg', '<svg onload="alert(1)"/>', { id: 'docker' }])(
    'preserves the caller fallback for unrecognized input: %j',
    icon => {
      render(<BrandIcon icon={icon} fallback={<span>Generic device</span>} />);
      expect(screen.getByText('Generic device')).toBeInTheDocument();
      expect(screen.queryByRole('img')).not.toBeInTheDocument();
    },
  );
});

describe('IconPicker', () => {
  it('searches, selects a brand, shows the selection on reopening and resets to default', async () => {
    const user = userEvent.setup();
    render(<ControlledPicker />);

    await user.click(screen.getByRole('button', { name: 'Icon' }));
    const dialog = screen.getByRole('dialog', { name: 'Choose an icon' });
    expect(within(dialog).getByRole('button', { name: 'Proxmox' })).toHaveAttribute('aria-pressed', 'true');
    await user.type(within(dialog).getByRole('searchbox', { name: 'Search icons' }), 'docker');
    await user.click(within(dialog).getByRole('button', { name: 'Docker' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Icon' }));
    const reopened = screen.getByRole('dialog', { name: 'Choose an icon' });
    expect(within(reopened).getByRole('searchbox', { name: 'Search icons' })).toHaveValue('');
    expect(within(reopened).getByRole('button', { name: 'Docker' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(within(reopened).getByRole('button', { name: 'Use default icon' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Icon' })).toHaveTextContent('Default');
  });

  it('preserves the choice when a filtered search is canceled or dismissed', async () => {
    const user = userEvent.setup();
    render(<ControlledPicker />);

    await user.click(screen.getByRole('button', { name: 'Icon' }));
    const dialog = screen.getByRole('dialog', { name: 'Choose an icon' });
    await user.type(within(dialog).getByRole('searchbox', { name: 'Search icons' }), 'PVE');
    await user.click(within(dialog).getByRole('button', { name: 'Hardware' }));
    expect(within(dialog).getByText(/No icons match your search/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'All' }));
    expect(within(dialog).getByRole('button', { name: 'Proxmox' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('button', { name: 'Icon' })).toHaveTextContent('Proxmox');

    await user.click(screen.getByRole('button', { name: 'Icon' }));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Icon' })).toHaveTextContent('Proxmox');
  });
});
