import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { InventoryManager } from './inventory-manager';

type InventoryDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/**
 * The whole inventory, opened over the canvas: what is not listed beside it
 * (cables, what is sold or broken) and every item's place and state, without
 * leaving the project.
 */
export function InventoryDialog({ open, onOpenChange }: InventoryDialogProps) {
  const [adding, setAdding] = useState(false);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-5xl overflow-y-auto">
        <DialogHeader className="pr-8 sm:flex-row sm:items-end sm:justify-between sm:space-y-0">
          <div>
            <DialogTitle>Inventory</DialogTitle>
            <DialogDescription className="mt-1.5">
              The hardware you own. It belongs to your account, so every project plans with the same
              list.
            </DialogDescription>
          </div>
          <Button size="sm" onClick={() => setAdding(true)}>
            Add an item
          </Button>
        </DialogHeader>
        <InventoryManager
          compact
          adding={adding}
          onAddingChange={setAdding}
          onNavigate={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}
