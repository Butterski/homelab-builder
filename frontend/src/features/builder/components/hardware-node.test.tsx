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
