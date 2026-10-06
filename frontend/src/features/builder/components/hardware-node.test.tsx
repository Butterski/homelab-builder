import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { HardwareNode } from './hardware-node';

vi.mock('@xyflow/react', () => ({
  Handle: () => <div data-testid="handle" />,
  Position: {
    Left: 'left',
    Right: 'right',
    Top: 'top',
    Bottom: 'bottom',
  },
  useUpdateNodeInternals: () => vi.fn(),
}));

vi.mock('../store/builder-store', () => ({
  useBuilderStore: (selector: (state: { validationIssues: never[]; edges: never[] }) => unknown) =>
    selector({
      validationIssues: [],
      edges: [],
    }),
}));

describe('HardwareNode IP and pool display', () => {
  it('shows assigned IP for IoT node without model and hides pool row', () => {
    render(
      <HardwareNode
        id="iot-1"
        selected={false}
        data={{
          label: 'IoT Sensor',
          type: 'iot',
          ip: '192.168.1.200',
          details: {},
          vms: [],
          internal_components: [],
        }}
        dragging={false}
        draggable
        selectable
        deletable
        zIndex={1}
        type="hardware"
        positionAbsoluteX={0}
        positionAbsoluteY={0}
        isConnectable
      />,
    );

    expect(screen.getByText('IP:')).toBeInTheDocument();
    expect(screen.getByText('192.168.1.200')).toBeInTheDocument();
    expect(screen.queryByText('Pool:')).not.toBeInTheDocument();
  });

  it('shows pool row for computer node types', () => {
    render(
      <HardwareNode
        id="pc-1"
        selected={false}
        data={{
          label: 'Workstation',
          type: 'pc',
          ip: '192.168.1.160',
          details: {},
          vms: [],
          internal_components: [],
        }}
        dragging={false}
        draggable
        selectable
        deletable
        zIndex={1}
        type="hardware"
        positionAbsoluteX={0}
        positionAbsoluteY={0}
        isConnectable
      />,
    );

    expect(screen.getByText('IP:')).toBeInTheDocument();
    expect(screen.getByText('192.168.1.160')).toBeInTheDocument();
    expect(screen.getByText('Pool:')).toBeInTheDocument();
    expect(screen.getByText(/192\.168\.1\.161/)).toBeInTheDocument();
  });
});

describe('HardwareNode gaming cards', () => {
  const card = (data: Record<string, unknown>) => (
    <HardwareNode
      id="node-1"
      selected={false}
      data={{ vms: [], internal_components: [], ...data } as never}
      dragging={false}
      draggable
      selectable
      deletable
      zIndex={1}
      type="hardware"
      positionAbsoluteX={0}
      positionAbsoluteY={0}
      isConnectable
    />
  );

  it('shows seats and the table switch on a LAN table, and no address of its own', () => {
    render(
      card({
        label: 'Table A',
        type: 'lan_table',
        details: { seats: 12, seat_watts: 350, switch_ports: 16, switch_speed: '2.5 GbE' },
      }),
    );

    expect(screen.getByText('LAN Table')).toBeInTheDocument();
    expect(screen.getByText('Seats:')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('16-port 2.5 GbE')).toBeInTheDocument();
    // The seats take leases; the table itself is never "unassigned".
    expect(screen.getByText('DHCP')).toBeInTheDocument();
    expect(screen.queryByText('unassigned')).not.toBeInTheDocument();
  });

  it('shows a console as a networked device', () => {
    render(card({ label: 'PS5', type: 'console', ip: '192.168.1.30', details: {} }));

    expect(screen.getByText('Console')).toBeInTheDocument();
    expect(screen.getByText('192.168.1.30')).toBeInTheDocument();
    expect(screen.queryByText('Pool:')).not.toBeInTheDocument();
  });

  it('shows the DHCP pool on the gateway that hands out the leases', () => {
    render(
      card({
        label: 'Router',
        type: 'router',
        ip: '192.168.1.1',
        details: {
          dhcp_pool: { start: '192.168.1.50', end: '192.168.1.149', size: 100, clients: 80 },
        },
      }),
    );

    expect(screen.getByText('DHCP:')).toBeInTheDocument();
    expect(screen.getByText('.50-.149')).toBeInTheDocument();
    expect(screen.getByTitle('100 addresses, 80 expected')).toBeInTheDocument();
  });
});
