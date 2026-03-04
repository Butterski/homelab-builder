// BETA_SURVEY - Remove this entire file + its features after beta ends.
import { useState } from "react"
import { useSurvey, useSubmitSurvey, useUpdateSurvey } from "../api/use-survey"
import { X, Star, ExternalLink } from "lucide-react"
import { Button } from "../../../components/ui/button"

interface SurveyModalProps {
    onClose: () => void
}

const STEPS = ["intro", "usage", "features", "opensource", "about", "contact", "company", "done"] as const
type Step = typeof STEPS[number]

interface FormState {
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

const defaultForm: FormState = {
    rating: 0,
    will_use_app: "",
    feature_wishlist: "",
    open_source_interest: "",
    contribution_intent: "",
    discord_handle: "",
    hear_about_us: "",
    experience_level: "",
    primary_use_case: "",
    is_company: false,
    company_contact: "",
}

export function SurveyModal({ onClose }: SurveyModalProps) { // BETA_SURVEY
    const { data: existing } = useSurvey()
    const submitMut = useSubmitSurvey()
    const updateMut = useUpdateSurvey()
    const isEditing = !!existing

    const [step, setStep] = useState<Step>(existing ? "usage" : "intro")
    const [form, setForm] = useState<FormState>({ ...defaultForm, ...existing })

    const set = (key: keyof FormState, val: string | number | boolean) => setForm(prev => ({ ...prev, [key]: val }))

    const handleSubmit = async () => {
        const fn = isEditing ? updateMut.mutateAsync : submitMut.mutateAsync
        await fn(form)
        setStep("done")
    }

    const isPending = submitMut.isPending || updateMut.isPending

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <div className="relative w-full max-w-lg bg-background border rounded-2xl shadow-2xl overflow-hidden">
                {/* Header */}
                <div className="flex items-center justify-between px-6 pt-5 pb-1">
                    <div className="flex items-center gap-2">
                        <span className="text-xs font-bold uppercase tracking-widest text-primary/70 bg-primary/10 px-2 py-0.5 rounded-full">Beta Survey</span>
                    </div>
                    <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors p-1 rounded-md hover:bg-accent">
                        <X className="h-4 w-4" />
                    </button>
                </div>

                {/* DB Wipe Warning Banner */}
                <div className="mx-6 mt-3 mb-1 rounded-lg bg-amber-500/10 border border-amber-500/30 px-4 py-2.5 text-xs text-amber-600 dark:text-amber-400 flex gap-2 items-start">
                    <span className="text-base leading-none mt-0.5">⚠️</span>
                    <span><strong>Beta DB Wipe Notice:</strong> The database will be wiped after the beta period ends. You'll be notified in advance so you can export your work before then.</span>
                </div>

                <div className="px-6 pb-6 pt-4 space-y-5">

                    {/* INTRO */}
                    {step === "intro" && (
                        <div className="space-y-4 text-center py-4">
                            <div className="text-4xl">🚀</div>
                            <h2 className="text-xl font-bold">Thanks for testing HLBuilder!</h2>
                            <p className="text-sm text-muted-foreground">This quick survey helps us understand what you need. It takes about 2 minutes and your answers directly shape the roadmap.</p>
                            <Button className="w-full" onClick={() => setStep("usage")}>Start Survey</Button>
                        </div>
                    )}

                    {/* USAGE */}
                    {step === "usage" && (
                        <div className="space-y-4">
                            <h3 className="font-semibold text-lg">How would you rate HLBuilder?</h3>
                            <div className="flex gap-2 justify-center">
                                {[1, 2, 3, 4, 5].map(n => (
                                    <button key={n} onClick={() => set("rating", n)} className="transition-transform hover:scale-110">
                                        <Star className={`h-9 w-9 ${form.rating >= n ? "fill-yellow-400 text-yellow-400" : "text-muted-foreground/30"}`} />
                                    </button>
                                ))}
                            </div>

                            <h3 className="font-semibold pt-2">Are you planning to use HLBuilder?</h3>
                            <div className="grid grid-cols-3 gap-2">
                                {[["yes", "Yes 🙌"], ["maybe", "Maybe 🤔"], ["no", "Not really 😬"]].map(([v, l]) => (
                                    <button key={v} onClick={() => set("will_use_app", v)}
                                        className={`rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${form.will_use_app === v ? "bg-primary text-primary-foreground border-primary" : "hover:bg-accent"}`}>
                                        {l}
                                    </button>
                                ))}
                            </div>

                            <h3 className="font-semibold pt-2">What best describes your use case?</h3>
                            <div className="grid grid-cols-2 gap-2">
                                {[["homeserver", "Home Server"], ["development", "Development"], ["learning", "Learning"], ["other", "Other"]].map(([v, l]) => (
                                    <button key={v} onClick={() => set("primary_use_case", v)}
                                        className={`rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${form.primary_use_case === v ? "bg-primary text-primary-foreground border-primary" : "hover:bg-accent"}`}>
                                        {l}
                                    </button>
                                ))}
                            </div>
                            <Button className="w-full" onClick={() => setStep("features")} disabled={!form.rating || !form.will_use_app}>Next →</Button>
                        </div>
                    )}

                    {/* FEATURES */}
                    {step === "features" && (
                        <div className="space-y-4">
                            <h3 className="font-semibold text-lg">What would you like to see in HLBuilder?</h3>
                            <textarea value={form.feature_wishlist} onChange={e => set("feature_wishlist", e.target.value)}
                                placeholder="More node types, monitoring integration, automatic config deployment..."
                                rows={4}
                                className="w-full rounded-lg border bg-background px-3 py-2 text-sm resize-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" />
                            <div className="flex gap-2">
                                <Button variant="outline" className="flex-1" onClick={() => setStep("usage")}>← Back</Button>
                                <Button className="flex-1" onClick={() => setStep("opensource")}>Next →</Button>
                            </div>
                        </div>
                    )}

                    {/* OPEN SOURCE */}
                    {step === "opensource" && (
                        <div className="space-y-4">
                            <h3 className="font-semibold text-lg">Are you interested in an open source model?</h3>
                            <p className="text-sm text-muted-foreground">We're exploring fully open-sourcing HLBuilder for self-hosting and community contributions.</p>
                            <div className="grid grid-cols-2 gap-2">
                                {[["yes", "Yes! 🎉"], ["no", "Not really"]].map(([v, l]) => (
                                    <button key={v} onClick={() => set("open_source_interest", v)}
                                        className={`rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${form.open_source_interest === v ? "bg-primary text-primary-foreground border-primary" : "hover:bg-accent"}`}>
                                        {l}
                                    </button>
                                ))}
                            </div>
                            {form.open_source_interest === "yes" && (
                                <div className="space-y-2 pt-1">
                                    <p className="text-sm font-medium">Would you want to...</p>
                                    <div className="grid grid-cols-2 gap-2">
                                        {[["contribute", "💻 Contribute code"], ["selfhost", "🏠 Self-host only"]].map(([v, l]) => (
                                            <button key={v} onClick={() => set("contribution_intent", v)}
                                                className={`rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${form.contribution_intent === v ? "bg-primary text-primary-foreground border-primary" : "hover:bg-accent"}`}>
                                                {l}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}
                            <div className="flex gap-2">
                                <Button variant="outline" className="flex-1" onClick={() => setStep("features")}>← Back</Button>
                                <Button className="flex-1" onClick={() => setStep("about")} disabled={!form.open_source_interest}>Next →</Button>
                            </div>
                        </div>
                    )}

                    {/* ABOUT */}
                    {step === "about" && (
                        <div className="space-y-4">
                            <h3 className="font-semibold text-lg">A bit about you</h3>

                            <div>
                                <label className="text-sm font-medium">Experience level</label>
                                <div className="grid grid-cols-3 gap-2 mt-2">
                                    {[["beginner", "Beginner"], ["intermediate", "Intermediate"], ["expert", "Expert"]].map(([v, l]) => (
                                        <button key={v} onClick={() => set("experience_level", v)}
                                            className={`rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${form.experience_level === v ? "bg-primary text-primary-foreground border-primary" : "hover:bg-accent"}`}>
                                            {l}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div>
                                <label className="text-sm font-medium">How did you hear about us?</label>
                                <div className="grid grid-cols-2 gap-2 mt-2">
                                    {[["reddit", "Reddit"], ["github", "GitHub"], ["friend", "Friend/Colleague"], ["other", "Other"]].map(([v, l]) => (
                                        <button key={v} onClick={() => set("hear_about_us", v)}
                                            className={`rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${form.hear_about_us === v ? "bg-primary text-primary-foreground border-primary" : "hover:bg-accent"}`}>
                                            {l}
                                        </button>
                                    ))}
                                </div>
                            </div>
                            <div className="flex gap-2">
                                <Button variant="outline" className="flex-1" onClick={() => setStep("opensource")}>← Back</Button>
                                <Button className="flex-1" onClick={() => setStep("contact")}>Next →</Button>
                            </div>
                        </div>
                    )}

                    {/* CONTACT */}
                    {step === "contact" && (
                        <div className="space-y-4">
                            <h3 className="font-semibold text-lg">Discord handle <span className="text-muted-foreground text-sm font-normal">(optional)</span></h3>
                            <p className="text-sm text-muted-foreground">Share your Discord username to get a <strong>Beta Tester</strong> rank once we open our server.</p>
                            <input value={form.discord_handle} onChange={e => set("discord_handle", e.target.value)}
                                placeholder="yourname or yourname#1234"
                                className="w-full rounded-lg border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" />
                            <div className="flex gap-2">
                                <Button variant="outline" className="flex-1" onClick={() => setStep("about")}>← Back</Button>
                                <Button className="flex-1" onClick={() => setStep("company")}>Next →</Button>
                            </div>
                        </div>
                    )}

                    {/* COMPANY */}
                    {step === "company" && (
                        <div className="space-y-4">
                            <h3 className="font-semibold text-lg">Business inquiry <span className="text-muted-foreground text-sm font-normal">(optional)</span></h3>
                            <p className="text-sm text-muted-foreground">Are you a company interested in implementing something like HLBuilder internally?</p>
                            <div className="grid grid-cols-2 gap-2">
                                <button onClick={() => set("is_company", true)}
                                    className={`rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${form.is_company ? "bg-primary text-primary-foreground border-primary" : "hover:bg-accent"}`}>
                                    Yes, tell me more
                                </button>
                                <button onClick={() => set("is_company", false)}
                                    className={`rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${!form.is_company ? "bg-accent" : "hover:bg-accent"}`}>
                                    No, I'm an individual
                                </button>
                            </div>
                            {form.is_company && (
                                <div>
                                    <label className="text-sm font-medium">Contact info / company name</label>
                                    <textarea value={form.company_contact} onChange={e => set("company_contact", e.target.value)}
                                        placeholder="Company name, email, LinkedIn, or anything you'd like to share..."
                                        rows={3}
                                        className="w-full mt-1 rounded-lg border bg-background px-3 py-2 text-sm resize-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" />
                                </div>
                            )}
                            <div className="flex gap-2">
                                <Button variant="outline" className="flex-1" onClick={() => setStep("contact")}>← Back</Button>
                                <Button className="flex-1" onClick={handleSubmit} disabled={isPending}>
                                    {isPending ? "Submitting..." : isEditing ? "Save Changes ✓" : "Submit Survey 🚀"}
                                </Button>
                            </div>
                        </div>
                    )}

                    {/* DONE / THANK YOU */}
                    {step === "done" && (
                        <div className="text-center py-6 space-y-5">
                            <div className="text-5xl">🎉</div>
                            <h2 className="text-xl font-bold">Thank you for the feedback!</h2>
                            <p className="text-sm text-muted-foreground">Your responses help shape the future of HLBuilder. Seriously — this means a lot. Come say hi:</p>
                            <div className="flex flex-col gap-2 items-center">
                                <a href="https://mkuch.pl" target="_blank" rel="noreferrer"
                                    className="flex items-center gap-2 text-sm text-primary hover:underline">
                                    <ExternalLink className="h-3.5 w-3.5" /> mkuch.pl — main site
                                </a>
                                <a href="https://in.mkuch.pl" target="_blank" rel="noreferrer"
                                    className="flex items-center gap-2 text-sm text-primary hover:underline">
                                    <ExternalLink className="h-3.5 w-3.5" /> in.mkuch.pl — LinkedIn
                                </a>
                                <a href="https://git.mkuch.pl" target="_blank" rel="noreferrer"
                                    className="flex items-center gap-2 text-sm text-primary hover:underline">
                                    <ExternalLink className="h-3.5 w-3.5" /> git.mkuch.pl — GitHub
                                </a>
                            </div>
                            <Button className="w-full" onClick={onClose}>Close</Button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}
