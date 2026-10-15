import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { HardwareNode } from './hardware-node';

vi.mock('@xyflow/react', () => ({
  Handle: ({ id, title, style }: { id?: string; title?: string; style?: React.CSSProperties }) => (
    <div data-testid="handle" data-handle-id={id} title={title} style={style} />
  ),
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

describe('HardwareNode handles', () => {
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
  const handleIds = () =>
    screen.getAllByTestId('handle').map(handle => handle.getAttribute('data-handle-id'));

  it('gives a device one power input per power supply', () => {
    render(card({ label: 'Storage', type: 'pc', details: { psu_count: 2 } }));

    expect(handleIds()).toEqual(['target-0', 'eth0', 'pwr-in-0', 'pwr-in-1']);
    expect(screen.getByTitle('PSU 2')).toBeInTheDocument();
  });

  it('gives a server with two power supplies two power inputs next to its ports', () => {
    render(card({ label: 'Server', type: 'server_v2', details: { psu_count: 2 } }));

    const ids = handleIds();
    expect(ids).toContain('pwr-in-0');
    expect(ids).toContain('pwr-in-1');
    expect(ids).not.toContain('pwr-in-2');
    expect(ids).toContain('target-0');
  });

  it('gives a UPS sockets and a power input but no network port', () => {
    render(card({ label: 'UPS', type: 'ups', details: {} }));

    const ids = handleIds();
    expect(ids).toEqual(['pwr-in-0', 'pwr-out-0', 'pwr-out-1', 'pwr-out-2', 'pwr-out-3', 'pwr-out-4', 'pwr-out-5']);
    expect(ids).not.toContain('target-0');
    expect(ids).not.toContain('eth0');
    // No load is known before the first save.
    expect(screen.getByText('Load:')).toBeInTheDocument();
    expect(screen.getByText('—/6')).toBeInTheDocument();
  });

  it('shows the load a UPS carries and marks it when over capacity', () => {
    render(
      card({
        label: 'UPS',
        type: 'ups',
        details: { power_load: { load_w: 1150, capacity_w: 900, sockets_used: 6, sockets: 6 } },
      }),
    );

    expect(screen.getByText('1150/900 W')).toHaveClass('text-red-300');
    expect(screen.getByText('6/6')).toBeInTheDocument();
  });

  it('colours a router port by its role and names it in the title', () => {
    render(
      card({
        label: 'Router',
        type: 'router',
        details: {
          ports: 2,
          port_config: { eth1: { role: 'dmz', address: '172.16.0.1/30', comment: 'lab' } },
        },
      }),
    );

    const port = screen.getByTitle('eth1 · DMZ · 172.16.0.1/30 · lab');
    expect(port.style.getPropertyValue('--node-accent')).toBe('#f97316');
    expect(screen.getByTitle('eth0').style.getPropertyValue('--node-accent')).toBe('');
  });
});
