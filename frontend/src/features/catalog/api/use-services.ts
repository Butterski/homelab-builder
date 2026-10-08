import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { api, ApiError } from "../../../lib/api"
import type { Service } from "../../../types"

/**
 * The services the caller can plan with: their own ones too when signed in (or
 * on an instance without login), the public catalog for a visitor.
 */
export async function fetchServices(): Promise<Service[]> {
    try {
        return (await api.get<{ data?: Service[] }>("/api/my-services")).data ?? []
    } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
            return (await api.get<{ data?: Service[] }>("/api/services")).data ?? []
        }
        throw error
    }
}

interface UserSelection {
    id: string
    service_id: string
    service: Service
    created_at: string
}

/** A visitor without an account has no favorites: pass `enabled: false` to not ask for them. */
export function useUserSelections(options?: { enabled?: boolean }) {
    return useQuery<{ data: UserSelection[] }>({
        queryKey: ["user-selections"],
        queryFn: () => api.get<{ data: UserSelection[] }>("/api/selections"),
        enabled: options?.enabled ?? true,
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
