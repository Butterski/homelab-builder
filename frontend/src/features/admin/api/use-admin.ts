import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { api } from "../../../lib/api"
import type { Service, User } from "../../../types"

interface AdminStats {
    total_users: number
    total_services: number
    total_selections: number
}

export const useAdminStats = () => {
    return useQuery({
        queryKey: ["admin", "stats"],
        queryFn: async () => {
            const response = await api.get<{ data: AdminStats }>("/api/admin/stats")
            return response.data
        },
    })
}

export const useAdminUsers = () => {
    return useQuery({
        queryKey: ["admin", "users"],
        queryFn: async () => {
            const response = await api.get<{ data: User[] }>("/api/admin/users")
            return response.data
        },
    })
}

export const useAdminServices = () => {
    // Re-use standard services or specific admin endpoint if needed
    // Usually admin needs raw data, but standard endpoint might be enough
    // For now assuming standard endpoint is fine, but maybe we need a mutation to toggle status
    return useQuery({
        queryKey: ["services"], // Same key as public to share cache or invalidate
        queryFn: async () => {
            const response = await api.get<{ data: Service[] }>("/api/services")
            return response.data
        }
    })
}

export const useToggleService = () => {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: async (id: string) => {
            return api.post(`/api/admin/services/${id}/toggle`, {})
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["services"] })
        },
    })
}

export const useCreateService = () => {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: async (data: Partial<Service>) => {
            return api.post("/api/services", data)
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
        mutationFn: async ({ id, data }: { id: string, data: Partial<Service> }) => {
            return api.put(`/admin/services/${id}`, data)
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
            return (api as any).del(`/admin/services/${id}`)
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["services"] })
            queryClient.invalidateQueries({ queryKey: ["admin", "stats"] })
        },
    })
}
