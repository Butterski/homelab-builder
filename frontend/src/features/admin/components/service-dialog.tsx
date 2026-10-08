import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import * as z from "zod"
import { Button } from "../../../components/ui/button"
import { Input } from "../../../components/ui/input"
import { Label } from "../../../components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "../../../components/ui/dialog"
import { useCreateService, useUpdateService } from "../api/use-admin"
import { useState, useEffect } from "react"
import type { ReactNode } from "react"
import type { Service } from "../../../types"

const serviceSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters"),
  description: z.string().min(10, "Description must be at least 10 characters"),
  category: z.string().min(1, "Category is required"),
  min_cpu_cores: z.coerce.number().min(1, "At least 1 core"),
  min_ram_mb: z.coerce.number().min(128, "At least 128MB"),
  min_storage_gb: z.coerce.number().min(1, "At least 1GB"),
})

type ServiceFormValues = z.output<typeof serviceSchema>

function formValues(service?: Service): ServiceFormValues {
  return {
    name: service?.name || "",
    description: service?.description || "",
    category: service?.category || "other",
    min_cpu_cores: service?.requirements?.min_cpu_cores || 1,
    min_ram_mb: service?.requirements?.min_ram_mb || 512,
    min_storage_gb: service?.requirements?.min_storage_gb || 10,
  }
}

interface ServiceDialogProps {
    initialData?: Service
    trigger?: ReactNode
}

export function ServiceDialog({ initialData, trigger }: ServiceDialogProps) {
  const [open, setOpen] = useState(false)
  const { mutate: createService, isPending: isCreating } = useCreateService()
  const { mutate: updateService, isPending: isUpdating } = useUpdateService()
  
  const isEditing = !!initialData
  const isPending = isCreating || isUpdating

  const form = useForm<z.input<typeof serviceSchema>, unknown, ServiceFormValues>({
    resolver: zodResolver(serviceSchema),
    defaultValues: formValues(initialData),
  })

  useEffect(() => {
    if (open) form.reset(formValues(initialData))
  }, [open, initialData, form])

  function onSubmit(data: ServiceFormValues) {
    const onSuccess = () => setOpen(false)
    if (initialData) {
        updateService({ id: initialData.id, data }, { onSuccess })
    } else {
        createService(data, { onSuccess })
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ? trigger : <Button>Add Service</Button>}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>{isEditing ? "Edit Service" : "Add New Service"}</DialogTitle>
          <DialogDescription>
            {isEditing ? "Modify the existing service template." : "Create a new service template for the catalog."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-4 py-4">
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="name" className="text-right">Name</Label>
            <Input id="name" className="col-span-3" {...form.register("name")} />
          </div>
          {form.formState.errors.name && (
              <p className="text-destructive text-xs text-right">{form.formState.errors.name.message}</p>
          )}

          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="category" className="text-right">Category</Label>
            <Input id="category" className="col-span-3" {...form.register("category")} />
          </div>

          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="description" className="text-right">Desc</Label>
            <Input id="description" className="col-span-3" {...form.register("description")} />
          </div>
          
           <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="cpu" className="text-right">CPU</Label>
            <Input id="cpu" type="number" className="col-span-3" {...form.register("min_cpu_cores")} />
          </div>
          
           <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="ram" className="text-right">RAM (MB)</Label>
            <Input id="ram" type="number" className="col-span-3" {...form.register("min_ram_mb")} />
          </div>

           <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="storage" className="text-right">Disk (GB)</Label>
            <Input id="storage" type="number" className="col-span-3" {...form.register("min_storage_gb")} />
          </div>

          <DialogFooter>
            <Button type="submit" disabled={isPending}>
                {isPending ? "Saving..." : "Save changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
