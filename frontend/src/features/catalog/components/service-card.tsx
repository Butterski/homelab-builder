import type { Service } from '../../../types';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '../../../components/ui/card';
import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import { Cpu, HardDrive, MemoryStick } from 'lucide-react';

interface ServiceCardProps {
  service: Service;
  onSelect?: (service: Service) => void;
  isSelected?: boolean;
}

export function ServiceCard({ service, onSelect, isSelected }: ServiceCardProps) {
  return (
    <Card
      className={`flex flex-col h-full transition-all ${isSelected ? 'ring-2 ring-primary border-primary' : ''}`}
    >
      <CardHeader>
        <div className="flex justify-between items-start">
          <CardTitle className="text-lg">{service.name}</CardTitle>
          <Badge variant="outline">{service.category}</Badge>
        </div>
        <CardDescription className="line-clamp-2 min-h-10">{service.description}</CardDescription>
      </CardHeader>
      <CardContent className="flex-1">
        <div className="grid grid-cols-3 gap-2 text-xs text-muted-foreground">
          <div className="flex flex-col items-center p-2 bg-muted rounded">
            <Cpu className="h-4 w-4 mb-1" />
            <span>{service.requirements?.min_cpu_cores || 1} vCPU</span>
          </div>
          <div className="flex flex-col items-center p-2 bg-muted rounded">
            <MemoryStick className="h-4 w-4 mb-1" />
            <span>{service.requirements?.min_ram_mb || 512} MB</span>
          </div>
          <div className="flex flex-col items-center p-2 bg-muted rounded">
            <HardDrive className="h-4 w-4 mb-1" />
            <span>{service.requirements?.min_storage_gb || 10} GB</span>
          </div>
        </div>
      </CardContent>
      <CardFooter>
        <Button
          className="w-full"
          variant={isSelected ? 'secondary' : 'default'}
          onClick={() => onSelect?.(service)}
        >
          {isSelected ? 'Selected' : 'Add to Build'}
        </Button>
      </CardFooter>
    </Card>
  );
}
