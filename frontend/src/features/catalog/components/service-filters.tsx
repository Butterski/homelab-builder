import { Button } from "../../../components/ui/button"
import { Check } from "lucide-react"

const CATEGORIES = [
  { id: 'all', label: 'All Services' },
  { id: 'media', label: 'Media' },
  { id: 'networking', label: 'Networking' },
  { id: 'monitoring', label: 'Monitoring' },
  { id: 'storage', label: 'Storage' },
  { id: 'management', label: 'Management' },
  { id: 'home_automation', label: 'Automation' },
  { id: 'gaming', label: 'Gaming' },
  { id: 'other', label: 'Other' },
]

interface ServiceFiltersProps {
  selectedCategory: string
  onSelectCategory: (category: string) => void
}

export function ServiceFilters({ selectedCategory, onSelectCategory }: ServiceFiltersProps) {
  return (
    <div className="space-y-4">
      <div className="font-semibold mb-2">Categories</div>
      <div className="flex flex-col space-y-1">
        {CATEGORIES.map((cat) => (
          <Button
            key={cat.id}
            variant={selectedCategory === cat.id ? "secondary" : "ghost"}
            className="justify-start"
            onClick={() => onSelectCategory(cat.id)}
          >
            {selectedCategory === cat.id && <Check className="mr-2 size-4" />}
            {cat.label}
          </Button>
        ))}
      </div>
    </div>
  )
}
