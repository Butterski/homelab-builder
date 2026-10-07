package proxmox

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// Proxmox answers with numbers that are sometimes strings ("8192") and flags
// that are 0, 1, "1" or true, depending on the endpoint and the version.

type flexNumber float64

func (n *flexNumber) UnmarshalJSON(raw []byte) error {
	raw = bytes.TrimSpace(raw)
	if len(raw) == 0 || string(raw) == "null" {
		return nil
	}
	if raw[0] == '"' {
		var text string
		if err := json.Unmarshal(raw, &text); err != nil {
			return err
		}
		value, err := strconv.ParseFloat(strings.TrimSpace(text), 64)
		if err != nil {
			return nil // not a number: leave it at zero
		}
		*n = flexNumber(value)
		return nil
	}
	if string(raw) == "true" {
		*n = 1
		return nil
	}
	if string(raw) == "false" {
		return nil
	}
	var value float64
	if err := json.Unmarshal(raw, &value); err != nil {
		return nil
	}
	*n = flexNumber(value)
	return nil
}

func (n flexNumber) asInt() int {
	value := float64(n)
	if math.IsNaN(value) || math.IsInf(value, 0) || value < 0 || value > math.MaxInt32 {
		return 0
	}
	return int(value)
}

func (n flexNumber) asBool() bool { return float64(n) != 0 }

const gib = 1024 * 1024 * 1024

func bytesToGB(value flexNumber) float64 {
	gb := float64(value) / gib
	if math.IsNaN(gb) || math.IsInf(gb, 0) || gb < 0 {
		return 0
	}
	return math.Round(gb*10) / 10
}

func bytesToMB(value flexNumber) int {
	mb := float64(value) / (1024 * 1024)
	if math.IsNaN(mb) || math.IsInf(mb, 0) || mb < 0 || mb > math.MaxInt32 {
		return 0
	}
	return int(math.Round(mb))
}

// resource is one entry of /cluster/resources.
type resource struct {
	Type     string     `json:"type"`
	Node     string     `json:"node"`
	Status   string     `json:"status"`
	Name     string     `json:"name"`
	VMID     flexNumber `json:"vmid"`
	MaxCPU   flexNumber `json:"maxcpu"`
	MaxMem   flexNumber `json:"maxmem"`
	Mem      flexNumber `json:"mem"`
	MaxDisk  flexNumber `json:"maxdisk"`
	Disk     flexNumber `json:"disk"`
	Uptime   flexNumber `json:"uptime"`
	Template flexNumber `json:"template"`
	Tags     string     `json:"tags"`
	Storage  string     `json:"storage"`
	Plugin   string     `json:"plugintype"`
	Shared   flexNumber `json:"shared"`
	Content  string     `json:"content"`
}

var tagSeparators = regexp.MustCompile(`[;, ]+`)

func splitTags(raw string) []string {
	tags := []string{}
	for _, tag := range tagSeparators.Split(strings.TrimSpace(raw), -1) {
		if tag != "" {
			tags = append(tags, tag)
		}
	}
	if len(tags) == 0 {
		return nil
	}
	return tags
}

func guestStatus(raw string) string {
	switch strings.ToLower(raw) {
	case "running":
		return StatusRunning
	case "paused", "suspended", "prelaunch":
		return StatusPaused
	default:
		return StatusStopped
	}
}

// cleanLabel keeps a name from a remote system printable and of a sane length.
func cleanLabel(value string, limit int) string {
	var out strings.Builder
	for _, r := range strings.TrimSpace(value) {
		if r < 0x20 || r == 0x7f {
			continue
		}
		out.WriteRune(r)
	}
	text := []rune(out.String())
	if len(text) > limit {
		text = text[:limit]
	}
	return string(text)
}

// applyResources turns the entries of /cluster/resources into the hosts,
// guests and storage of a snapshot. It is the whole of a pasted export and the
// skeleton of one read from the API.
func (s *Snapshot) applyResources(resources []resource) {
	for _, entry := range resources {
		node := cleanLabel(entry.Node, 63)
		switch entry.Type {
		case "node":
			if node == "" {
				continue
			}
			s.Nodes = append(s.Nodes, Node{
				Name:          node,
				Online:        strings.EqualFold(entry.Status, "online"),
				Threads:       entry.MaxCPU.asInt(),
				MemoryMB:      bytesToMB(entry.MaxMem),
				MemoryUsedMB:  bytesToMB(entry.Mem),
				DiskGB:        bytesToGB(entry.MaxDisk),
				UptimeSeconds: int64(entry.Uptime.asInt()),
			})
		case "qemu", "lxc":
			vmid := entry.VMID.asInt()
			if vmid == 0 || node == "" {
				continue
			}
			kind := GuestVM
			if entry.Type == "lxc" {
				kind = GuestLXC
			}
			name := cleanLabel(entry.Name, 120)
			if name == "" {
				name = fmt.Sprintf("%s-%d", kind, vmid)
			}
			s.Guests = append(s.Guests, Guest{
				VMID: vmid, Name: name, Kind: kind, Node: node,
				Status: guestStatus(entry.Status), Template: entry.Template.asBool(),
				CPUs: float64(entry.MaxCPU), MemoryMB: bytesToMB(entry.MaxMem), DiskGB: bytesToGB(entry.MaxDisk),
				Tags: splitTags(entry.Tags),
			})
		case "storage":
			name := cleanLabel(entry.Storage, 100)
			if name == "" || node == "" {
				continue
			}
			s.Storage = append(s.Storage, Storage{
				Name: name, Node: node, Type: cleanLabel(entry.Plugin, 40), Shared: entry.Shared.asBool(),
				Active:  strings.EqualFold(entry.Status, "available"),
				TotalGB: bytesToGB(entry.MaxDisk), UsedGB: bytesToGB(entry.Disk),
				Content: cleanLabel(entry.Content, 120),
			})
		}
	}
	// A token without Sys.Audit sees guests but no hosts: name the hosts the
	// guests live on, so the guests still have a place.
	known := map[string]bool{}
	for _, node := range s.Nodes {
		known[node.Name] = true
	}
	for _, guest := range s.Guests {
		if !known[guest.Node] {
			known[guest.Node] = true
			s.Nodes = append(s.Nodes, Node{Name: guest.Node, Online: true})
		}
	}
}

// ErrNotAnExport means pasted text is not the output this app can read.
var ErrNotAnExport = errors.New("this is not the output of: pvesh get /cluster/resources --output-format json")

// MaxExportBytes bounds a pasted export.
const MaxExportBytes = 2 * 1024 * 1024

// ParseExport reads what a user pasted: the JSON printed by
//
//	pvesh get /cluster/resources --output-format json
//
// on a Proxmox host, or the same list inside the API's {"data": ...} envelope.
// It has every host, guest and storage with its size and state. It has no
// processor model, no addresses and no network interfaces: those need the API.
func ParseExport(raw []byte, now time.Time) (*Snapshot, error) {
	raw = bytes.TrimSpace(raw)
	if len(raw) == 0 {
		return nil, ErrNotAnExport
	}
	if len(raw) > MaxExportBytes {
		return nil, fmt.Errorf("the export is too large (%d MB at most)", MaxExportBytes/(1024*1024))
	}
	var resources []resource
	if raw[0] == '{' {
		var envelope struct {
			Data []resource `json:"data"`
		}
		if err := json.Unmarshal(raw, &envelope); err != nil {
			return nil, ErrNotAnExport
		}
		resources = envelope.Data
	} else if err := json.Unmarshal(raw, &resources); err != nil {
		return nil, ErrNotAnExport
	}

	snapshot := &Snapshot{Source: SourcePaste, FetchedAt: now.UTC()}
	snapshot.applyResources(resources)
	if len(snapshot.Nodes) == 0 {
		return nil, ErrNotAnExport
	}
	snapshot.Notes = []string{
		"An export lists hosts, guests and storage with their sizes. Processor models, addresses and network interfaces are only read over the API.",
	}
	snapshot.sort()
	return snapshot, nil
}

// ── Guest configuration ──────────────────────────────────────────────────────

var hardwareAddress = regexp.MustCompile(`(?i)^([0-9a-f]{2}:){5}[0-9a-f]{2}$`)

// guestNIC is what a netN line of a guest's configuration says.
type guestNIC struct {
	MAC    string
	Bridge string
	VLAN   int
	IP     string
}

// parseNIC reads a netN value. A virtual machine writes
// "virtio=BC:24:11:AA:BB:CC,bridge=vmbr0,tag=20"; a container writes
// "name=eth0,bridge=vmbr0,hwaddr=BC:24:11:AA:BB:CC,ip=192.168.20.15/24".
func parseNIC(value string) guestNIC {
	nic := guestNIC{}
	for _, part := range strings.Split(value, ",") {
		key, val, found := strings.Cut(strings.TrimSpace(part), "=")
		if !found {
			continue
		}
		val = strings.TrimSpace(val)
		switch strings.ToLower(key) {
		case "bridge":
			nic.Bridge = cleanLabel(val, 40)
		case "tag":
			if tag, err := strconv.Atoi(val); err == nil && tag > 0 && tag < 4095 {
				nic.VLAN = tag
			}
		case "hwaddr", "macaddr":
			if hardwareAddress.MatchString(val) {
				nic.MAC = strings.ToUpper(val)
			}
		case "ip":
			nic.IP = hostAddress(val)
		default:
			// The model of a virtual NIC is the key: virtio=<mac>, e1000=<mac>.
			if nic.MAC == "" && hardwareAddress.MatchString(val) {
				nic.MAC = strings.ToUpper(val)
			}
		}
	}
	return nic
}

// hostAddress takes the IPv4 address out of "192.168.1.5/24". "dhcp" and
// "manual" are no address.
func hostAddress(value string) string {
	value = strings.TrimSpace(value)
	if address, _, found := strings.Cut(value, "/"); found {
		value = address
	}
	if ip := net.ParseIP(value).To4(); ip != nil {
		return ip.String()
	}
	return ""
}

// parseIPConfig reads the address out of a cloud-init line: "ip=192.168.1.50/24,gw=192.168.1.1".
func parseIPConfig(value string) string {
	for _, part := range strings.Split(value, ",") {
		key, val, found := strings.Cut(strings.TrimSpace(part), "=")
		if found && strings.EqualFold(key, "ip") {
			return hostAddress(val)
		}
	}
	return ""
}

var osNames = map[string]string{
	"l26": "Linux", "l24": "Linux 2.4", "other": "",
	"win11": "Windows 11", "win10": "Windows 10", "win8": "Windows 8", "win7": "Windows 7",
	"wvista": "Windows Vista", "wxp": "Windows XP", "w2k": "Windows 2000",
	"w2k3": "Windows Server 2003", "w2k8": "Windows Server 2008", "solaris": "Solaris",
	"debian": "Debian", "ubuntu": "Ubuntu", "alpine": "Alpine Linux", "centos": "CentOS",
	"fedora": "Fedora", "archlinux": "Arch Linux", "opensuse": "openSUSE", "gentoo": "Gentoo",
	"nixos": "NixOS", "devuan": "Devuan", "unmanaged": "",
}

func osName(ostype string) string {
	ostype = strings.ToLower(strings.TrimSpace(ostype))
	if name, known := osNames[ostype]; known {
		return name
	}
	return cleanLabel(ostype, 40)
}
