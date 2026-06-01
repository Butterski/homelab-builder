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

export interface CustomServicePayload {
    name: string
    description: string
    category: string
    official_website?: string
    docs_url?: string
    github_url?: string
    tags: string
    docker_support: boolean
    min_cpu_cores: number
    recommended_cpu_cores: number
    min_ram_mb: number
    recommended_ram_mb: number
    min_storage_gb: number
    recommended_storage_gb: number
}

export function useCreateCustomService() {
    const qc = useQueryClient()
    return useMutation({
        mutationFn: (payload: CustomServicePayload) =>
            api.post<{ data: Service }>("/api/my-services", payload),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ["services"] })
            qc.invalidateQueries({ queryKey: ["user-selections"] })
        },
    })
}

export function useSubmitCustomService() {
    const qc = useQueryClient()
    return useMutation({
        mutationFn: (serviceId: string) =>
            api.patch<{ data: Service }>(`/api/my-services/${serviceId}/submit-community`, {}),
        onSuccess: () => qc.invalidateQueries({ queryKey: ["services"] }),
    })
}
