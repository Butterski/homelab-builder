package proxmox

import (
	"fmt"
	"math"
	"sort"
)

// Reconciling is comparing a plan with what a cluster really runs: which
// planned host is which Proxmox host, which guests are on both sides, which
// only on one, and how full each host is. Nothing here changes anything; the
// result is a report the owner decides on.

// PlannedGuest is a virtual machine, container or service of the plan.
type PlannedGuest struct {
	ID       string
	Name     string
	Kind     string
	CPUs     float64
	MemoryMB int
	DiskGB   float64
	Status   string
	// VMID is the Proxmox id the guest was imported from; 0 when it never was.
	VMID int
}

// PlannedHost is a device of the plan that can run guests.
type PlannedHost struct {
	ID        string
	Name      string
	CPUs      float64
	RAMGB     float64
	StorageGB float64
	// ProxmoxNode is the host the plan already names for this device.
	ProxmoxNode string
	// ItemID is the inventory item the device stands for.
	ItemID string
	Guests []PlannedGuest
}

const (
	// ChoiceNew imports a host as a new device; ChoiceSkip leaves it out.
	ChoiceNew  = "new"
	ChoiceSkip = "skip"

	PairedByChoice    = "choice"
	PairedByLink      = "link"
	PairedByInventory = "inventory"
	PairedByName      = "name"

	FigureSame    = "same"
	FigureDiffers = "differs"
	FigureUnknown = "unknown"

	GuestMatched    = "matched"
	GuestDiscovered = "discovered"
	GuestMissing    = "missing"
)

// Pairing says which device of the plan a Proxmox host is.
type Pairing struct {
	PlannedID string
	By        string
	Skip      bool
}

// PairHosts decides, for every host, which planned device it is. What the
// owner chose comes first, then what the plan already says, then the
// inventory item both stand for, then an equal name. A planned device is
// paired with one host at most.
//
// itemNode maps an inventory item id to the host it is linked to.
func PairHosts(nodes []Node, planned []PlannedHost, itemNode map[string]string, choices map[string]string) map[string]Pairing {
	pairs := map[string]Pairing{}
	taken := map[string]bool{}
	byID := map[string]PlannedHost{}
	for _, host := range planned {
		byID[host.ID] = host
	}

	for _, node := range nodes {
		switch choice := choices[node.Name]; {
		case choice == ChoiceSkip:
			pairs[node.Name] = Pairing{Skip: true, By: PairedByChoice}
		case choice == ChoiceNew:
			pairs[node.Name] = Pairing{By: PairedByChoice}
		case choice != "":
			if _, known := byID[choice]; known && !taken[choice] {
				pairs[node.Name] = Pairing{PlannedID: choice, By: PairedByChoice}
				taken[choice] = true
			}
		}
	}
	pass := func(by string, fits func(node Node, host PlannedHost) bool) {
		for _, node := range nodes {
			if _, done := pairs[node.Name]; done {
				continue
			}
			for _, host := range planned {
				if !taken[host.ID] && fits(node, host) {
					pairs[node.Name] = Pairing{PlannedID: host.ID, By: by}
					taken[host.ID] = true
					break
				}
			}
		}
	}
	pass(PairedByLink, func(node Node, host PlannedHost) bool {
		return host.ProxmoxNode != "" && host.ProxmoxNode == node.Name
	})
	pass(PairedByInventory, func(node Node, host PlannedHost) bool {
		return host.ItemID != "" && itemNode[host.ItemID] == node.Name
	})
	pass(PairedByName, func(node Node, host PlannedHost) bool {
		name := NormalizeName(node.Name)
		return name != "" && NormalizeName(host.Name) == name
	})
	for _, node := range nodes {
		if _, done := pairs[node.Name]; !done {
			pairs[node.Name] = Pairing{}
		}
	}
	return pairs
}

// Figure is one number of the plan beside the same number on the cluster.
type Figure struct {
	Planned float64 `json:"planned"`
	Actual  float64 `json:"actual"`
	State   string  `json:"state"`
}

func compare(planned, actual float64, same func() bool) Figure {
	figure := Figure{Planned: planned, Actual: actual, State: FigureUnknown}
	if planned > 0 && actual > 0 {
		figure.State = FigureDiffers
		if same() {
			figure.State = FigureSame
		}
	}
	return figure
}

// GuestRow is one guest of the comparison.
type GuestRow struct {
	State       string `json:"state"`
	VMID        int    `json:"vmid,omitempty"`
	Name        string `json:"name"`
	Kind        string `json:"kind"`
	Status      string `json:"status,omitempty"`
	IP          string `json:"ip,omitempty"`
	PlannedID   string `json:"planned_id,omitempty"`
	PlannedName string `json:"planned_name,omitempty"`
	// MatchedBy is "id" (imported from this guest before) or "name".
	MatchedBy string  `json:"matched_by,omitempty"`
	CPUs      Figure  `json:"cpus"`
	MemoryMB  Figure  `json:"memory_mb"`
	DiskGB    float64 `json:"disk_gb,omitempty"`
	// Differs: on both sides, but with another size or state than planned.
	Differs bool `json:"differs"`
}

// Load is how much of a host its guests take: by the plan, and really.
type Load struct {
	Capacity float64 `json:"capacity"`
	Planned  float64 `json:"planned"`
	Actual   float64 `json:"actual"`
}

// HostReport compares one Proxmox host with the planned device it is.
type HostReport struct {
	Node        string `json:"node"`
	Online      bool   `json:"online"`
	Skipped     bool   `json:"skipped"`
	PlannedID   string `json:"planned_id,omitempty"`
	PlannedName string `json:"planned_name,omitempty"`
	PairedBy    string `json:"paired_by,omitempty"`

	CPUs      Figure `json:"cpus"`
	RAMGB     Figure `json:"ram_gb"`
	StorageGB Figure `json:"storage_gb"`

	Guests []GuestRow `json:"guests"`

	MemoryMB Load `json:"memory_mb"`
	VCPUs    Load `json:"vcpus"`
	DiskGB   Load `json:"disk_gb"`
	// HeadroomPercent is the memory left free by whichever is larger, the plan
	// or what runs. -1 when the host's memory is not known.
	HeadroomPercent int      `json:"headroom_percent"`
	Warnings        []string `json:"warnings"`
}

// Totals add the plan and the cluster up over every compared host.
type Totals struct {
	VCPUs    Load `json:"vcpus"`
	MemoryMB Load `json:"memory_mb"`
	DiskGB   Load `json:"disk_gb"`
}

// Counts say how the guests fall out.
type Counts struct {
	Matched    int `json:"matched"`
	Differing  int `json:"differing"`
	Discovered int `json:"discovered"`
	Missing    int `json:"missing"`
}

// Reconciliation is the whole comparison.
type Reconciliation struct {
	Hosts  []HostReport `json:"hosts"`
	Totals Totals       `json:"totals"`
	Counts Counts       `json:"counts"`
}

const (
	// A planned guest without a size counts as the builder counts it.
	defaultGuestMemoryMB = 512
	defaultGuestCPUs     = 1
	defaultGuestDiskGB   = 10
	// Less free memory than this and a host is called close to full.
	tightHeadroomPercent = 20
)

// storageFits: what a host can store is always somewhat less than the size
// printed on its disks, and never much more.
func storageFits(plannedGB, actualGB float64) bool {
	return actualGB >= plannedGB*0.7 && actualGB <= plannedGB*1.1
}

// NominalRAMGB guesses the memory fitted in a host from what it shows: a host
// with 32 GB shows about 31.2.
func NominalRAMGB(memoryMB int) float64 {
	shown := float64(memoryMB) / 1024
	step := 32.0
	switch {
	case shown <= 0:
		return 0
	case shown <= 8:
		step = 1
	case shown <= 64:
		step = 4
	case shown <= 256:
		step = 16
	}
	return math.Ceil(shown/step-0.001) * step
}

func hostStorageGB(snapshot *Snapshot, node Node) float64 {
	if local := snapshot.LocalStorageGB(node.Name); local > 0 {
		return math.Round(local)
	}
	return math.Round(node.DiskGB)
}

// matchGuests pairs the guests of a planned device with those of its host:
// first by the Proxmox id a guest was imported from, then by name.
func matchGuests(planned []PlannedGuest, actual []Guest) (pairs map[int]int, by map[int]string) {
	pairs, by = map[int]int{}, map[int]string{} // index in actual -> index in planned
	usedPlanned := map[int]bool{}
	take := func(a, p int, how string) {
		pairs[a], by[a] = p, how
		usedPlanned[p] = true
	}
	for a, guest := range actual {
		for p, plan := range planned {
			if !usedPlanned[p] && plan.VMID > 0 && plan.VMID == guest.VMID {
				take(a, p, "id")
				break
			}
		}
	}
	for a, guest := range actual {
		if _, done := pairs[a]; done {
			continue
		}
		name := NormalizeName(guest.Name)
		if name == "" {
			continue
		}
		for p, plan := range planned {
			// A guest linked to another id is that other guest, whatever it is called.
			if !usedPlanned[p] && plan.VMID == 0 && NormalizeName(plan.Name) == name {
				take(a, p, "name")
				break
			}
		}
	}
	return pairs, by
}

func consumes(status string) bool { return status != StatusStopped }

func orDefault(value, fallback float64) float64 {
	if value > 0 {
		return value
	}
	return fallback
}

// Reconcile compares the plan with the snapshot, host by host.
func Reconcile(snapshot *Snapshot, planned []PlannedHost, pairs map[string]Pairing) Reconciliation {
	result := Reconciliation{Hosts: []HostReport{}}
	byID := map[string]PlannedHost{}
	for _, host := range planned {
		byID[host.ID] = host
	}

	nodes := append([]Node(nil), snapshot.Nodes...)
	sort.SliceStable(nodes, func(i, j int) bool { return nodes[i].Name < nodes[j].Name })
	for _, node := range nodes {
		pair := pairs[node.Name]
		report := HostReport{
			Node: node.Name, Online: node.Online, Skipped: pair.Skip, PairedBy: pair.By,
			Guests: []GuestRow{}, Warnings: []string{}, HeadroomPercent: -1,
		}
		if pair.Skip {
			result.Hosts = append(result.Hosts, report)
			continue
		}
		plan, inPlan := byID[pair.PlannedID]
		actualGuests := snapshot.GuestsOn(node.Name)
		storage := hostStorageGB(snapshot, node)

		if inPlan {
			report.PlannedID, report.PlannedName = plan.ID, plan.Name
			report.CPUs = compare(plan.CPUs, float64(node.Threads), func() bool {
				return plan.CPUs == float64(node.Threads) || (node.Cores > 0 && plan.CPUs == float64(node.Cores))
			})
			report.RAMGB = compare(plan.RAMGB, math.Round(float64(node.MemoryMB)/1024*10)/10, func() bool {
				return memoryFits(node.MemoryMB, plan.RAMGB)
			})
			report.StorageGB = compare(plan.StorageGB, storage, func() bool { return storageFits(plan.StorageGB, storage) })
		} else {
			report.PairedBy = ""
			report.CPUs = Figure{Actual: float64(node.Threads), State: FigureUnknown}
			report.RAMGB = Figure{Actual: math.Round(float64(node.MemoryMB)/1024*10) / 10, State: FigureUnknown}
			report.StorageGB = Figure{Actual: storage, State: FigureUnknown}
		}

		pairsByActual, matchedBy := matchGuests(plan.Guests, actualGuests)
		seenPlanned := map[int]bool{}
		for a, guest := range actualGuests {
			row := GuestRow{
				State: GuestDiscovered, VMID: guest.VMID, Name: guest.Name, Kind: guest.Kind,
				Status: guest.Status, IP: guest.IP, DiskGB: guest.DiskGB,
				CPUs:     Figure{Actual: guest.CPUs, State: FigureUnknown},
				MemoryMB: Figure{Actual: float64(guest.MemoryMB), State: FigureUnknown},
			}
			if p, matched := pairsByActual[a]; matched {
				planGuest := plan.Guests[p]
				seenPlanned[p] = true
				row.State, row.MatchedBy = GuestMatched, matchedBy[a]
				row.PlannedID, row.PlannedName = planGuest.ID, planGuest.Name
				row.CPUs = compare(planGuest.CPUs, guest.CPUs, func() bool { return planGuest.CPUs == guest.CPUs })
				row.MemoryMB = compare(float64(planGuest.MemoryMB), float64(guest.MemoryMB), func() bool {
					return planGuest.MemoryMB == guest.MemoryMB
				})
				row.Differs = row.CPUs.State == FigureDiffers || row.MemoryMB.State == FigureDiffers ||
					(planGuest.Status != "" && planGuest.Status != guest.Status)
				result.Counts.Matched++
				if row.Differs {
					result.Counts.Differing++
				}
			} else {
				result.Counts.Discovered++
			}
			report.Guests = append(report.Guests, row)

			report.DiskGB.Actual += guest.DiskGB
			if consumes(guest.Status) {
				report.MemoryMB.Actual += float64(guest.MemoryMB)
				report.VCPUs.Actual += guest.CPUs
			}
		}
		for p, planGuest := range plan.Guests {
			if !seenPlanned[p] {
				report.Guests = append(report.Guests, GuestRow{
					State: GuestMissing, Name: planGuest.Name, Kind: planGuest.Kind, Status: planGuest.Status,
					PlannedID: planGuest.ID, PlannedName: planGuest.Name, VMID: planGuest.VMID,
					CPUs:     Figure{Planned: planGuest.CPUs, State: FigureUnknown},
					MemoryMB: Figure{Planned: float64(planGuest.MemoryMB), State: FigureUnknown},
				})
				result.Counts.Missing++
			}
			report.DiskGB.Planned += orDefault(planGuest.DiskGB, defaultGuestDiskGB)
			if consumes(planGuest.Status) {
				report.MemoryMB.Planned += orDefault(float64(planGuest.MemoryMB), defaultGuestMemoryMB)
				report.VCPUs.Planned += orDefault(planGuest.CPUs, defaultGuestCPUs)
			}
		}

		report.MemoryMB.Capacity = float64(node.MemoryMB)
		report.VCPUs.Capacity = float64(node.Threads)
		report.DiskGB.Capacity = storage
		if inPlan {
			// An export of an offline host has no figures: the plan's are the best there are.
			report.MemoryMB.Capacity = orDefault(report.MemoryMB.Capacity, plan.RAMGB*1024)
			report.VCPUs.Capacity = orDefault(report.VCPUs.Capacity, plan.CPUs)
			report.DiskGB.Capacity = orDefault(report.DiskGB.Capacity, plan.StorageGB)
		}
		report.DiskGB.Planned = math.Round(report.DiskGB.Planned)
		report.DiskGB.Actual = math.Round(report.DiskGB.Actual)

		if capacity := report.MemoryMB.Capacity; capacity > 0 {
			used := math.Max(report.MemoryMB.Planned, report.MemoryMB.Actual)
			report.HeadroomPercent = int(math.Round(100 - used/capacity*100))
			switch {
			case report.MemoryMB.Actual > capacity:
				report.Warnings = append(report.Warnings, "The running guests are given more memory than the host has.")
			case report.MemoryMB.Planned > capacity:
				report.Warnings = append(report.Warnings, "The plan gives guests more memory than the host has.")
			case report.HeadroomPercent < tightHeadroomPercent:
				report.Warnings = append(report.Warnings, fmt.Sprintf("Only %d%% of the memory is left. This host is close to full.", report.HeadroomPercent))
			}
		}
		if capacity := report.DiskGB.Capacity; capacity > 0 && report.DiskGB.Actual > capacity {
			report.Warnings = append(report.Warnings, "The guests' disks add up to more than the host's own storage; they are thin-provisioned or live on shared storage.")
		}

		for _, pair := range []struct{ total, host *Load }{
			{&result.Totals.VCPUs, &report.VCPUs}, {&result.Totals.MemoryMB, &report.MemoryMB}, {&result.Totals.DiskGB, &report.DiskGB},
		} {
			pair.total.Capacity += pair.host.Capacity
			pair.total.Planned += pair.host.Planned
			pair.total.Actual += pair.host.Actual
		}
		result.Hosts = append(result.Hosts, report)
	}
	return result
}
