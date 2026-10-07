package proxmox

import (
	"fmt"
	"math"
	"regexp"
	"sort"
	"strings"
)

// Matching a Proxmox host to a machine in the inventory is weighing evidence:
// the same processor, the same memory, the same number of threads. None of it
// is proof, so the result is a suggestion with the reasons behind it, and the
// owner decides.

// Candidate is an inventory device a host could be.
type Candidate struct {
	ID       string
	Name     string
	Notes    string
	CPUModel string
	Cores    int
	Threads  int
	RAMGB    float64
	MACs     []string
	// LinkedNode is the host this item is already linked to in this
	// integration. LinkedElsewhere: it stands for a machine somewhere else.
	LinkedNode      string
	LinkedElsewhere bool
}

// Reason is one piece of evidence for or against a match.
type Reason struct {
	Signal string `json:"signal"` // linked | mac | cpu | memory | threads | name | tie
	Agrees bool   `json:"agrees"`
	Text   string `json:"text"`
}

// Suggestion is an inventory item a host may be, and how sure that is.
type Suggestion struct {
	ItemID     string   `json:"item_id"`
	ItemName   string   `json:"item_name"`
	Confidence int      `json:"confidence"` // 0 to 100
	Reasons    []Reason `json:"reasons"`
}

const (
	weightCPU     = 45.0
	weightMemory  = 25.0
	weightThreads = 15.0
	weightName    = 10.0

	// Below this a pairing is not worth showing.
	minConfidence = 40
	// Evidence short of a hardware address is never certain.
	maxInferred = 98
	// One figure alone (only the memory, say) fits many machines.
	maxThinEvidence = 60
	maxSuggestions  = 3
)

var cpuNoise = regexp.MustCompile(`(?i)\(r\)|\(tm\)|\bcpu\b|\bprocessor\b|\bwith\b.*$|@.*$|\b\d+-core\b|\b\d+(st|nd|rd|th)\s+gen\b|\b\d+(\.\d+)?\s*ghz\b`)
var cpuRevision = regexp.MustCompile(`(\d)(v\d+)\b`)
var cpuDesignator = regexp.MustCompile(`[a-z]*\d[a-z0-9]*`)

// cpuKey reduces a processor name to its model number, which is what two
// spellings of the same processor share: "AMD Ryzen 5 PRO 4650GE with Radeon
// Graphics" and "Ryzen 4650GE" both give "4650ge"; "Intel(R) Core(TM) i5-9500T
// CPU @ 2.20GHz" and "i5 9500T" both give "9500t".
func cpuKey(model string) string {
	cleaned := strings.ToLower(cpuNoise.ReplaceAllString(model, " "))
	cleaned = cpuRevision.ReplaceAllString(cleaned, "$1 $2")
	parts := []string{}
	for _, token := range cpuDesignator.FindAllString(cleaned, -1) {
		// A series or revision ("ryzen 5", "i5", "v4") is not the model.
		if len(token) < 3 {
			continue
		}
		parts = append(parts, token)
	}
	sort.Strings(parts)
	return strings.Join(parts, " ")
}

// memoryFits reports whether a host that shows actualMB could be a machine
// sold with nominalGB. A host always shows a little less than is fitted:
// firmware and an integrated graphics chip take their share.
func memoryFits(actualMB int, nominalGB float64) bool {
	if actualMB <= 0 || nominalGB <= 0 {
		return false
	}
	actualGB := float64(actualMB) / 1024
	return actualGB >= nominalGB*0.85 && actualGB <= nominalGB*1.02
}

func sharesMAC(node Node, macs []string) (known, shared bool) {
	hostMACs := map[string]bool{}
	for _, iface := range node.Interfaces {
		if iface.MAC != "" {
			hostMACs[strings.ToUpper(iface.MAC)] = true
		}
	}
	if len(hostMACs) == 0 || len(macs) == 0 {
		return false, false
	}
	for _, mac := range macs {
		if hostMACs[strings.ToUpper(mac)] {
			return true, true
		}
	}
	return true, false
}

func gb(value float64) string {
	if value == math.Trunc(value) {
		return fmt.Sprintf("%d GB", int(value))
	}
	return fmt.Sprintf("%.1f GB", value)
}

// score weighs one candidate against one host. strength is how much evidence
// agrees: two candidates as sure as each other are told apart by it.
func score(node Node, candidate Candidate) (confidence int, strength float64, reasons []Reason) {
	if candidate.LinkedNode == node.Name && node.Name != "" {
		return 100, 1000, []Reason{{Signal: "linked", Agrees: true, Text: "You linked them before."}}
	}
	reasons = []Reason{}
	if known, shared := sharesMAC(node, candidate.MACs); known {
		if shared {
			return 100, 1000, []Reason{{Signal: "mac", Agrees: true, Text: "A network card has the same hardware address."}}
		}
		reasons = append(reasons, Reason{Signal: "mac", Agrees: false, Text: "No network card has a hardware address noted for this item."})
		return 15, 0, reasons
	}

	considered, agreeing := 0.0, 0.0
	weigh := func(weight float64, agrees bool, signal, text string) {
		considered += weight
		if agrees {
			agreeing += weight
		}
		reasons = append(reasons, Reason{Signal: signal, Agrees: agrees, Text: text})
	}

	if hostCPU, itemCPU := cpuKey(node.CPUModel), cpuKey(candidate.CPUModel); hostCPU != "" && itemCPU != "" {
		if hostCPU == itemCPU {
			weigh(weightCPU, true, "cpu", "Same processor: "+candidate.CPUModel+".")
		} else {
			weigh(weightCPU, false, "cpu", "Different processor: the host has "+node.CPUModel+".")
		}
	}
	if node.MemoryMB > 0 && candidate.RAMGB > 0 {
		shown := gb(math.Round(float64(node.MemoryMB)/1024*10) / 10)
		if memoryFits(node.MemoryMB, candidate.RAMGB) {
			weigh(weightMemory, true, "memory", "Same memory: "+gb(candidate.RAMGB)+" (the host shows "+shown+").")
		} else {
			weigh(weightMemory, false, "memory", "Different memory: "+gb(candidate.RAMGB)+" against "+shown+" on the host.")
		}
	}
	switch {
	case node.Threads > 0 && candidate.Threads > 0:
		agrees := node.Threads == candidate.Threads
		text := fmt.Sprintf("Same number of threads: %d.", node.Threads)
		if !agrees {
			text = fmt.Sprintf("Different number of threads: %d against %d on the host.", candidate.Threads, node.Threads)
		}
		weigh(weightThreads, agrees, "threads", text)
	case candidate.Cores > 0 && (node.Cores > 0 || node.Threads > 0):
		// Only the cores are noted: they fit a host with that many cores, with
		// or without two threads on each.
		agrees := candidate.Cores == node.Cores || candidate.Cores == node.Threads || candidate.Cores*2 == node.Threads
		text := fmt.Sprintf("Same number of cores: %d.", candidate.Cores)
		if !agrees {
			text = fmt.Sprintf("Different number of cores: %d noted, the host has %d threads.", candidate.Cores, node.Threads)
		}
		weigh(weightThreads, agrees, "threads", text)
	}
	if host := NormalizeName(node.Name); len(host) >= 3 {
		if strings.Contains(NormalizeName(candidate.Name), host) || strings.Contains(NormalizeName(candidate.Notes), host) {
			weigh(weightName, true, "name", "The item mentions the host name "+node.Name+".")
		}
	}

	if considered == 0 {
		return 0, 0, reasons
	}
	confidence = int(math.Round(100 * agreeing / considered))
	if considered < weightCPU && confidence > maxThinEvidence {
		confidence = maxThinEvidence
	}
	if confidence > maxInferred {
		confidence = maxInferred
	}
	return confidence, agreeing, reasons
}

// Suggest ranks the inventory devices a host could be, best first. Items that
// already stand for another machine are left out.
func Suggest(node Node, candidates []Candidate) []Suggestion {
	suggestions := []Suggestion{}
	strength := map[string]float64{}
	for _, candidate := range candidates {
		if candidate.LinkedElsewhere || (candidate.LinkedNode != "" && candidate.LinkedNode != node.Name) {
			continue
		}
		confidence, agreeing, reasons := score(node, candidate)
		if confidence < minConfidence {
			continue
		}
		strength[candidate.ID] = agreeing
		suggestions = append(suggestions, Suggestion{
			ItemID: candidate.ID, ItemName: candidate.Name, Confidence: confidence, Reasons: reasons,
		})
	}
	sort.SliceStable(suggestions, func(i, j int) bool {
		if suggestions[i].Confidence != suggestions[j].Confidence {
			return suggestions[i].Confidence > suggestions[j].Confidence
		}
		if strength[suggestions[i].ItemID] != strength[suggestions[j].ItemID] {
			return strength[suggestions[i].ItemID] > strength[suggestions[j].ItemID]
		}
		return suggestions[i].ItemName < suggestions[j].ItemName
	})
	// Two machines of the same model cannot be told apart by their figures,
	// unless something more speaks for one of them.
	if len(suggestions) > 1 && suggestions[0].Confidence < 100 {
		best, bestStrength := suggestions[0].Confidence, strength[suggestions[0].ItemID]
		// Decided before anything is changed below.
		tied := make([]bool, len(suggestions))
		for i := range suggestions {
			tied[i] = best-suggestions[i].Confidence < 5 && bestStrength-strength[suggestions[i].ItemID] < weightName
		}
		for i := range suggestions {
			if !tied[1] || !tied[i] {
				break
			}
			if suggestions[i].Confidence > 70 {
				suggestions[i].Confidence = 70
			}
			suggestions[i].Reasons = append(suggestions[i].Reasons, Reason{
				Signal: "tie", Agrees: false, Text: "Another item fits just as well; pick the one that is this machine.",
			})
		}
	}
	if len(suggestions) > maxSuggestions {
		suggestions = suggestions[:maxSuggestions]
	}
	return suggestions
}
