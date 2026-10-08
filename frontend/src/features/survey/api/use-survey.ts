// BETA_SURVEY - Remove this entire file after beta ends.
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { api } from "../../../lib/api"

const SURVEY_QUERY_KEY = ["beta-survey"] // BETA_SURVEY

/** The answers of the survey; a stored survey carries them too. */
export interface SurveyAnswers {
    rating: number
    will_use_app: string
    feature_wishlist: string
    open_source_interest: string
    contribution_intent: string
    discord_handle: string
    hear_about_us: string
    experience_level: string
    primary_use_case: string
    is_company: boolean
    company_contact: string
}

export function useSurvey(options?: { enabled?: boolean }) { // BETA_SURVEY
    return useQuery({
        queryKey: SURVEY_QUERY_KEY,
        enabled: options?.enabled ?? true,
        queryFn: async () => {
            try {
                const res = await api.get<{ data?: SurveyAnswers }>("/api/survey")
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
        mutationFn: (data: SurveyAnswers) => api.post("/api/survey", data),
        onSuccess: () => qc.invalidateQueries({ queryKey: SURVEY_QUERY_KEY }),
    })
}

export function useUpdateSurvey() { // BETA_SURVEY
    const qc = useQueryClient()
    return useMutation({
        mutationFn: (data: SurveyAnswers) => api.put("/api/survey", data),
        onSuccess: () => qc.invalidateQueries({ queryKey: SURVEY_QUERY_KEY }),
    })
}
