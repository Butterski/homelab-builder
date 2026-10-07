import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import type { HardwareNode } from '../../../types';

vi.mock('@/lib/api', () => ({ api: {}, ApiError: class ApiError extends Error {} }));
vi.mock('@/features/builder/api/builds', () => ({ buildApi: {} }));
vi.mock('@/features/builder/api/proposals', () => ({ proposalApi: {} }));
vi.mock('@/services/api', () => ({
  api: { getServices: vi.fn().mockResolvedValue({ data: [] }) },
}));

import { useBuilderStore } from '../../builder/store/builder-store';
import { GamingNodeFields } from './gaming-node-fields';

// The other tests of these fields use a store double that calls a selector
// once. The real store compares what a selector returns with the call before,
// so one that builds a new array every time renders until React gives up: that
// took the builder down whenever a device was selected in a build without
// power circuits. These tests run the fields on the real store.
describe('GamingNodeFields on the builder store', () => {
  const accessPoint: HardwareNode = { id: 'ap', type: 'access_point', name: 'AP', x: 0, y: 0 };

  beforeEach(() => {
    useBuilderStore.getState().clearCurrentBuild();
  });

  it('renders for a device of a build that has no power circuits', () => {
    useBuilderStore.setState({ hardwareNodes: [accessPoint], gamingPlan: {} });
    render(<GamingNodeFields node={accessPoint} />);
    expect(screen.getByLabelText('Wi-Fi devices expected')).toBeInTheDocument();
    expect(screen.queryByLabelText('Power circuit')).not.toBeInTheDocument();
  });

  it('adds nothing to an ordinary device there', () => {
    const server: HardwareNode = { id: 's', type: 'server_v2', name: 'Server', x: 0, y: 0 };
    useBuilderStore.setState({ hardwareNodes: [server], gamingPlan: {} });
    const { container } = render(<GamingNodeFields node={server} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('offers the circuits of the plan', () => {
    useBuilderStore.setState({
      hardwareNodes: [accessPoint],
      gamingPlan: {
        power: { mains_voltage: 230, circuits: [{ id: 'c1', label: 'Hall', breaker_amps: 16 }] },
      },
    });
    render(<GamingNodeFields node={accessPoint} />);
    const options = within(screen.getByLabelText('Power circuit')).getAllByRole('option');
    expect(options.some(option => option.textContent?.includes('Hall'))).toBe(true);
  });
});
