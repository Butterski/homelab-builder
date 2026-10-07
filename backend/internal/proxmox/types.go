// Package proxmox reads what really runs on a Proxmox VE cluster and compares
// it with a plan: the hosts, their virtual machines and containers, and how
// much of each host they take.
//
// It only ever reads. Every request it makes is a GET, and an API token with
// the PVEAuditor role is all it needs. It imports nothing internal, so the
// services can use it without a cycle.
package proxmox

import (
	"sort"
	"strings"
	"time"
)

const (
	// SourceAPI is a snapshot read from the Proxmox API.
	SourceAPI = "api"
	// SourcePaste is a snapshot made from an export the user pasted.
	SourcePaste = "paste"

	GuestVM  = "vm"
	GuestLXC = "lxc"

	StatusRunning = "running"
	StatusStopped = "stopped"
	StatusPaused  = "paused"
)

// Snapshot is a cluster as it was at one moment, in the app's own terms.
type Snapshot struct {
	Source    string    `json:"source"`
	FetchedAt time.Time `json:"fetched_at"`
	Version   string    `json:"version,omitempty"` // "8.2.4"
	// Cluster is the cluster's name; empty for a single host.
	Cluster string    `json:"cluster,omitempty"`
	Nodes   []Node    `json:"nodes"`
	Guests  []Guest   `json:"guests"`
	Storage []Storage `json:"storage"`
	// Notes say, in words for the owner, what could not be read.
	Notes []string `json:"notes,omitempty"`
}

// Node is one Proxmox host.
type Node struct {
	Name     string `json:"name"`
	Online   bool   `json:"online"`
	Address  string `json:"address,omitempty"`
	CIDR     string `json:"cidr,omitempty"`
	Gateway  string `json:"gateway,omitempty"`
	CPUModel string `json:"cpu_model,omitempty"`
	Sockets  int    `json:"sockets,omitempty"`
	// Cores are physical cores over all sockets; Threads are logical processors.
	Cores         int         `json:"cores,omitempty"`
	Threads       int         `json:"threads"`
	MemoryMB      int         `json:"memory_mb"`
	MemoryUsedMB  int         `json:"memory_used_mb,omitempty"`
	DiskGB        float64     `json:"disk_gb,omitempty"` // root filesystem
	Version       string      `json:"version,omitempty"`
	Kernel        string      `json:"kernel,omitempty"`
	UptimeSeconds int64       `json:"uptime_seconds,omitempty"`
	Interfaces    []Interface `json:"interfaces,omitempty"`
}

// Interface is a network interface of a host.
type Interface struct {
	Name        string `json:"name"`
	Type        string `json:"type"` // eth, bridge, bond, vlan
	Active      bool   `json:"active"`
	Address     string `json:"address,omitempty"`
	CIDR        string `json:"cidr,omitempty"`
	Gateway     string `json:"gateway,omitempty"`
	BridgePorts string `json:"bridge_ports,omitempty"`
	MAC         string `json:"mac,omitempty"`
}

// Guest is a virtual machine or a container.
type Guest struct {
	VMID     int      `json:"vmid"`
	Name     string   `json:"name"`
	Kind     string   `json:"kind"` // vm | lxc
	Node     string   `json:"node"`
	Status   string   `json:"status"`
	Template bool     `json:"template,omitempty"`
	CPUs     float64  `json:"cpus"`
	MemoryMB int      `json:"memory_mb"`
	DiskGB   float64  `json:"disk_gb"`
	OS       string   `json:"os,omitempty"`
	Tags     []string `json:"tags,omitempty"`
	IP       string   `json:"ip,omitempty"`
	MAC      string   `json:"mac,omitempty"`
	Bridge   string   `json:"bridge,omitempty"`
	VLAN     int      `json:"vlan,omitempty"`
}

// Storage is a storage as one host sees it.
type Storage struct {
	Name    string  `json:"name"`
	Node    string  `json:"node"`
	Type    string  `json:"type,omitempty"`
	Shared  bool    `json:"shared,omitempty"`
	Active  bool    `json:"active"`
	TotalGB float64 `json:"total_gb"`
	UsedGB  float64 `json:"used_gb"`
	Content string  `json:"content,omitempty"`
}

// Summary is a snapshot in a line: "Proxmox VE 8.2.4, cluster homelab, 3 nodes, 11 VMs, 7 LXCs".
type Summary struct {
	Version     string `json:"version,omitempty"`
	Cluster     string `json:"cluster,omitempty"`
	Nodes       int    `json:"nodes"`
	NodesOnline int    `json:"nodes_online"`
	VMs         int    `json:"vms"`
	Containers  int    `json:"containers"`
	Templates   int    `json:"templates"`
}

// Node finds a host by name.
func (s *Snapshot) Node(name string) (Node, bool) {
	for _, node := range s.Nodes {
		if node.Name == name {
			return node, true
		}
	}
	return Node{}, false
}

// GuestsOn lists the guests of a host that are not templates, by id.
func (s *Snapshot) GuestsOn(node string) []Guest {
	guests := []Guest{}
	for _, guest := range s.Guests {
		if guest.Node == node && !guest.Template {
			guests = append(guests, guest)
		}
	}
	sort.SliceStable(guests, func(i, j int) bool { return guests[i].VMID < guests[j].VMID })
	return guests
}

// Guest finds a guest by its id.
func (s *Snapshot) Guest(vmid int) (Guest, bool) {
	for _, guest := range s.Guests {
		if guest.VMID == vmid {
			return guest, true
		}
	}
	return Guest{}, false
}

// LocalStorageGB adds up the storage that lives in a host itself. Shared
// storage (NFS, Ceph) belongs to no single machine.
func (s *Snapshot) LocalStorageGB(node string) float64 {
	total := 0.0
	for _, storage := range s.Storage {
		if storage.Node == node && !storage.Shared {
			total += storage.TotalGB
		}
	}
	return total
}

// Summarize counts what a snapshot holds.
func (s *Snapshot) Summarize() Summary {
	summary := Summary{Version: s.Version, Cluster: s.Cluster, Nodes: len(s.Nodes)}
	for _, node := range s.Nodes {
		if node.Online {
			summary.NodesOnline++
		}
	}
	for _, guest := range s.Guests {
		switch {
		case guest.Template:
			summary.Templates++
		case guest.Kind == GuestLXC:
			summary.Containers++
		default:
			summary.VMs++
		}
	}
	return summary
}

// sortSnapshot puts everything in one order, so two readings of the same
// cluster are equal.
func (s *Snapshot) sort() {
	sort.SliceStable(s.Nodes, func(i, j int) bool { return s.Nodes[i].Name < s.Nodes[j].Name })
	sort.SliceStable(s.Guests, func(i, j int) bool { return s.Guests[i].VMID < s.Guests[j].VMID })
	sort.SliceStable(s.Storage, func(i, j int) bool {
		if s.Storage[i].Node != s.Storage[j].Node {
			return s.Storage[i].Node < s.Storage[j].Node
		}
		return s.Storage[i].Name < s.Storage[j].Name
	})
	for i := range s.Nodes {
		interfaces := s.Nodes[i].Interfaces
		sort.SliceStable(interfaces, func(a, b int) bool { return interfaces[a].Name < interfaces[b].Name })
	}
	if s.Nodes == nil {
		s.Nodes = []Node{}
	}
	if s.Guests == nil {
		s.Guests = []Guest{}
	}
	if s.Storage == nil {
		s.Storage = []Storage{}
	}
}

// NormalizeName reduces a name to what two spellings of it share: "Pi-hole",
// "pihole" and "PiHole" are the same guest.
func NormalizeName(name string) string {
	var out strings.Builder
	for _, r := range strings.ToLower(name) {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') {
			out.WriteRune(r)
		}
	}
	return out.String()
}
