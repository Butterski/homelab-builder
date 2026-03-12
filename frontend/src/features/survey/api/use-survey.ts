// BETA_SURVEY - Remove this entire file after beta ends.
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { api } from "../../../services/api"

export const SURVEY_QUERY_KEY = ["beta-survey"] // BETA_SURVEY

export function useSurvey(options?: { enabled?: boolean }) { // BETA_SURVEY
    return useQuery({
        queryKey: SURVEY_QUERY_KEY,
        enabled: options?.enabled ?? true,
        queryFn: async () => {
            try {
                const res = await api.getSurvey()
                return res.data ?? null
            } catch {
                return null // 404 = not submitted yet
            }
        },
    })
}

export function useSubmitSurvey() { // BETA_SURVEY
    const qc = useQueryClient()
    return useMutation({
        mutationFn: (data: any) => api.submitSurvey(data),
        onSuccess: () => qc.invalidateQueries({ queryKey: SURVEY_QUERY_KEY }),
    })
}

export function useUpdateSurvey() { // BETA_SURVEY
    const qc = useQueryClient()
    return useMutation({
        mutationFn: (data: any) => api.updateSurvey(data),
        onSuccess: () => qc.invalidateQueries({ queryKey: SURVEY_QUERY_KEY }),
    })
}
