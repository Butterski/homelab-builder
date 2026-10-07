import { useState } from 'react';
import { Page, PageHeader } from '@/components/layout/page';
import { Button } from '@/components/ui/button';
import { IntegrationsSection } from '@/features/integrations/components/integrations-section';
import { InventoryManager } from '../components/inventory-manager';

/**
 * The hardware the user owns, outside any project: the same list the canvas
 * shows beside it, in full, with the integrations that say what runs on it.
 */
export default function InventoryPage() {
  const [adding, setAdding] = useState(false);

  return (
    <Page className="pb-16">
      <PageHeader
        title="Inventory"
        lede="The hardware you own. Every project plans with this list: drag an item onto a canvas from the library there, and it is never something to buy."
        actions={<Button onClick={() => setAdding(true)}>Add an item</Button>}
      />
      <div className="pt-6">
        <InventoryManager adding={adding} onAddingChange={setAdding} />
      </div>
      <IntegrationsSection />
    </Page>
  );
}
