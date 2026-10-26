import { beforeEach, expect, it } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { useBuilderStore } from '../store/builder-store';
import { VMManager } from './vm-manager';

const details = {
  icon: 'docker',
  disk_gb: 24,
  notes: 'Keep the world backup',
  game: { profile: 'minecraft', players: 8, exposure: 'lan', port_offset: 0 },
};
const guest = () => useBuilderStore.getState().hardwareNodes[0].vms![0];

function chooseIcon(name: string) {
  fireEvent.click(screen.getByRole('button', { name: 'Icon' }));
  fireEvent.change(screen.getByRole('searchbox', { name: 'Search icons' }), {
    target: { value: name },
  });
  fireEvent.click(screen.getByRole('button', { name }));
}

beforeEach(() => {
  useBuilderStore.getState().clearCurrentBuild();
  act(() => useBuilderStore.getState().addHardware({
    id: 'host', type: 'server_v2', name: 'Host', x: 0, y: 0,
    vms: [{ id: 'guest', name: 'Game', type: 'container', status: 'running', details }],
  }));
  render(<VMManager nodeId="host" />);
});

it('saves a guest icon without losing guest metadata, cancels a draft, and resets to the type icon', () => {
  fireEvent.click(screen.getByRole('button', { name: 'Edit Game' }));
  chooseIcon('Jellyfin');
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(guest().details).toEqual({ ...details, icon: 'jellyfin', static_ip: '' });

  fireEvent.click(screen.getByRole('button', { name: 'Edit Game' }));
  chooseIcon('Proxmox');
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(guest().details?.icon).toBe('jellyfin');

  fireEvent.click(screen.getByRole('button', { name: 'Edit Game' }));
  fireEvent.click(screen.getByRole('button', { name: 'Icon' }));
  fireEvent.click(screen.getByRole('button', { name: 'Use default icon' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(guest().details).not.toHaveProperty('icon');
  expect(guest().details).toMatchObject({ disk_gb: 24, notes: details.notes, game: details.game });
});

it('adds a guest with the chosen brand', () => {
  fireEvent.click(screen.getByRole('button', { name: 'Add' }));
  fireEvent.change(screen.getByPlaceholderText('e.g. nginx'), { target: { value: 'Media' } });
  chooseIcon('Jellyfin');
  fireEvent.click(screen.getByRole('button', { name: 'Add Container' }));
  const added = useBuilderStore.getState().hardwareNodes[0].vms!.find(vm => vm.name === 'Media');
  expect(added).toMatchObject({ type: 'container', details: { icon: 'jellyfin' } });
});
