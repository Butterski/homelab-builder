import { describe, expect, it } from 'vitest';
import type { HardwareNode } from '../../../types';
import { generateShoppingList } from './generator';

const node = (overrides: Partial<HardwareNode>): HardwareNode => ({
  id: 'n',
  type: 'minipc',
  name: 'Mini PC',
  x: 0,
  y: 0,
  details: {},
  ...overrides,
});

describe('generateShoppingList', () => {
  it('leaves out what the owner already has', () => {
    const items = generateShoppingList(
      [],
      [
        node({
          id: 'a',
          type: 'pc',
          name: 'proxmox-01',
          details: { model: 'Lenovo ThinkCentre M75q', inventory_item_id: 'item-1' },
        }),
        node({
          id: 'b',
          type: 'switch',
          name: 'Core switch',
          details: { model: 'TP-Link TL-SG108E', ports: 8 },
        }),
        node({ id: 'c', type: 'nas', name: 'Storage' }),
      ],
    );
    const names = items.map(item => item.name);
    expect(names).toContain('TP-Link TL-SG108E');
    expect(names).toContain('Synology DS923+');
    // The machine from the inventory is planned with, not bought.
    expect(names).not.toContain('Lenovo ThinkCentre M75q');
    expect(items).toHaveLength(2);
  });

  it("lists a machine that is nobody's yet", () => {
    const items = generateShoppingList(
      [],
      [node({ type: 'pc', details: { model: 'Lenovo ThinkCentre M75q' } })],
    );
    expect(items.map(item => item.name)).toEqual(['Lenovo ThinkCentre M75q']);
  });
});
