import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../../components/ui/table"
import type { Service } from "../../../types"
import { Button } from "../../../components/ui/button"
import { Edit2, Trash2 } from "lucide-react"
import { useDeleteService } from "../api/use-admin"
import { ServiceDialog } from "./service-dialog"

interface ServicesTableProps {
  services: Service[] | undefined
  isLoading: boolean
}

export function ServicesTable({ services, isLoading }: ServicesTableProps) {
  const { mutate: deleteService } = useDeleteService()

  if (isLoading) {
    return <div>Loading...</div> // Or skeleton rows
  }

  if (!services || services.length === 0) {
    return <div className="text-center p-4">No services found.</div>
  }

  return (
    <div className="border rounded-md">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Category</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {services.map((service) => (
            <TableRow key={service.id}>
              <TableCell className="font-medium">
                <div className="flex flex-col">
                    <span>{service.name}</span>
                    <span className="text-xs text-muted-foreground truncate max-w-[200px]">{service.description}</span>
                </div>
              </TableCell>
              <TableCell className="capitalize">{service.category}</TableCell>
              <TableCell>
                <div className={`flex items-center gap-2 ${service.is_active ? "text-green-500" : "text-muted-foreground"}`}>
                    <span className={`h-2 w-2 rounded-full ${service.is_active ? "bg-green-500" : "bg-muted-foreground"}`} />
                    {service.is_active ? "Active" : "Inactive"}
                </div>
              </TableCell>
              <TableCell className="text-right">
                <div className="flex justify-end gap-2">
                    <ServiceDialog 
                        initialData={service} 
                        trigger={
                            <Button variant="ghost" size="icon">
                                <Edit2 className="h-4 w-4" />
                            </Button>
                        } 
                    />
                    <Button 
                        variant="ghost" 
                        size="icon" 
                        className="text-destructive"
                        onClick={() => {
                            if (window.confirm(`Are you sure you want to permanently delete '${service.name}'?`)) {
                                deleteService(service.id)
                            }
                        }}
                    >
                        <Trash2 className="h-4 w-4" />
                    </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
