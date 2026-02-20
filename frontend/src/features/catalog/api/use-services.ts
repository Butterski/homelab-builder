import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { api } from "../../../lib/api"
import type { Service } from "../../../types"

export interface UserSelection {
    id: string
    service_id: string
    service: Service
    created_at: string
}

export function useUserSelections() {
    return useQuery<{ data: UserSelection[] }>({
        queryKey: ["user-selections"],
        queryFn: () => api.get<{ data: UserSelection[] }>("/api/selections"),
    })
}

export function useAddSelection() {
    const qc = useQueryClient()
    return useMutation({
        mutationFn: (serviceId: string) => api.post("/api/selections", { service_id: serviceId }),
        onSuccess: () => qc.invalidateQueries({ queryKey: ["user-selections"] }),
    })
}

export function useRemoveSelection() {
    const qc = useQueryClient()
    return useMutation({
        mutationFn: (selectionId: string) => api.del(`/api/selections/${selectionId}`),
        onSuccess: () => qc.invalidateQueries({ queryKey: ["user-selections"] }),
    })
}
