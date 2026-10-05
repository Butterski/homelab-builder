package llm

// Provider ids.
const (
	ProviderAnthropic        = "anthropic"
	ProviderOpenAI           = "openai"
	ProviderGemini           = "gemini"
	ProviderOpenRouter       = "openrouter"
	ProviderOllama           = "ollama"
	ProviderOpenAICompatible = "openai_compatible"
)

// Preset describes a provider the assistant can use.
type Preset struct {
	ID    string `json:"id"`
	Label string `json:"label"`
	// DefaultModel is suggested when the user has not picked one. Most presets
	// leave it empty: the model list is loaded from the provider with the
	// user's key instead of being guessed here.
	DefaultModel string `json:"default_model"`
	// BaseURL is the provider's endpoint, or the suggested one when CustomBaseURL is set.
	BaseURL string `json:"base_url"`
	// CustomBaseURL lets the user point the provider at their own endpoint.
	CustomBaseURL bool `json:"custom_base_url"`
	// KeyRequired is false for endpoints that commonly run without a key.
	KeyRequired bool   `json:"key_required"`
	KeyHelpURL  string `json:"key_help_url,omitempty"`
	Note        string `json:"note,omitempty"`
}

// Presets lists the supported providers in the order the settings page shows them.
var Presets = []Preset{
	{
		ID: ProviderAnthropic, Label: "Anthropic (Claude)", DefaultModel: "claude-opus-5",
		BaseURL: "https://api.anthropic.com", KeyRequired: true,
		KeyHelpURL: "https://console.anthropic.com/settings/keys",
		Note:       "Claude Opus 5 and Fable models can decline a request. HLBuilder asks Anthropic to answer with another Claude model when that happens (server-side fallback), so a chat does not stop midway.",
	},
	{
		ID: ProviderOpenAI, Label: "OpenAI",
		BaseURL: "https://api.openai.com/v1", KeyRequired: true,
		KeyHelpURL: "https://platform.openai.com/api-keys",
	},
	{
		ID: ProviderGemini, Label: "Google Gemini",
		BaseURL: "https://generativelanguage.googleapis.com/v1beta/openai/", KeyRequired: true,
		KeyHelpURL: "https://aistudio.google.com/apikey",
	},
	{
		ID: ProviderOpenRouter, Label: "OpenRouter",
		BaseURL: "https://openrouter.ai/api/v1", KeyRequired: true,
		KeyHelpURL: "https://openrouter.ai/keys",
	},
	{
		ID: ProviderOllama, Label: "Ollama (local models)",
		BaseURL: "http://host.docker.internal:11434/v1", CustomBaseURL: true,
		Note: "Use a model that supports tool calling. The address must be reachable from the HLBuilder server.",
	},
	{
		ID: ProviderOpenAICompatible, Label: "Other OpenAI-compatible endpoint",
		CustomBaseURL: true,
		Note:          "Any server that implements the OpenAI chat completions API with tool calling (LM Studio, vLLM, LiteLLM, ...).",
	},
}

// PresetByID finds a preset.
func PresetByID(id string) (Preset, bool) {
	for _, preset := range Presets {
		if preset.ID == id {
			return preset, true
		}
	}
	return Preset{}, false
}
