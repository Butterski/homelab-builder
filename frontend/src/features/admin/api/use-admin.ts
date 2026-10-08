import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { api } from "../../../lib/api"
import type { Service, User } from "../../../types"

export interface AdminDashboardStats {
    total_users: number
    total_services: number
    total_selections: number
    total_builds: number
    avg_nodes_per_build: number
    avg_vms_per_build: number
    node_distribution: Array<{ type: string; count: number }>
    brand_market_share: Array<{ brand: string; count: number }>
    active_services_distribution: Array<{ name: string; count: number }>
    popular_services: Array<{ service_name: string; count: number }>
}

export const useAdminStats = () => {
    return useQuery({
        queryKey: ["admin", "stats"],
        queryFn: async () => {
            const response = await api.get<{ data: AdminDashboardStats }>("/api/admin/dashboard")
            return response.data
        },
    })
}

export interface EnrichedUser extends User {
    builds_count: number
    nodes_count: number
    vms_count: number
    created_at: string
}

export const useAdminUsers = () => {
    return useQuery({
        queryKey: ["admin", "users"],
        queryFn: async () => {
            const response = await api.get<{ data: EnrichedUser[] }>("/api/admin/users")
            return response.data
        },
    })
}

export const useAdminServices = () => {
    return useQuery({
        queryKey: ["services"], // Same key as public to share cache or invalidate
        queryFn: async () => {
            const response = await api.get<{ data: Service[] }>("/api/services")
            return response.data
        }
    })
}

/** What the admin service form sends: the requirements are flat fields, as the backend takes them. */
interface ServiceInput {
    name: string
    description: string
    category: string
    min_cpu_cores: number
    min_ram_mb: number
    min_storage_gb: number
}

export const useCreateService = () => {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: async (data: ServiceInput) => {
            return api.post("/api/admin/services", data)
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["services"] })
            queryClient.invalidateQueries({ queryKey: ["admin", "stats"] })
        },
    })
}

export const useUpdateService = () => {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: async ({ id, data }: { id: string, data: ServiceInput }) => {
            return api.put(`/api/admin/services/${id}`, data)
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["services"] })
        },
    })
}

export const useDeleteService = () => {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: async (id: string) => {
            return api.del(`/api/admin/services/${id}`)
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["services"] })
            queryClient.invalidateQueries({ queryKey: ["admin", "stats"] })
        },
    })
}
