// Package inventory describes the hardware a user owns: what kinds of things
// can be kept, which figures they carry, and how an owned device turns into a
// node on the canvas. It imports nothing internal, so models, services and the
// Proxmox import can all use it.
package inventory

import (
	"errors"
	"fmt"
	"math"
	"regexp"
	"sort"
	"strings"
)

const (
	KindDevice    = "device"
	KindComponent = "component"
	KindAccessory = "accessory"

	StatusAvailable = "available"
	StatusInUse     = "in_use"
	StatusReserved  = "reserved"
	StatusBroken    = "broken"
	StatusSold      = "sold"

	// DetailItemID is the key in a node's or component's details that names the
	// inventory item it stands for. DetailLabel keeps the item's name next to
	// it, so a build still says what the machine is where the inventory cannot
	// be read (a share link) or after the item was deleted.
	DetailItemID   = "inventory_item_id"
	DetailLabel    = "inventory_label"
	DetailQuantity = "inventory_quantity"

	maxNameLength  = 120
	maxTextLength  = 120
	maxNotesLength = 2000
	maxMACs        = 16
	maxQuantity    = 999
)

// ErrInvalid marks an item that cannot be stored as given.
var ErrInvalid = errors.New("invalid inventory item")

// A device type is also the node type it becomes on the canvas.
var typesByKind = map[string][]string{
	KindDevice: {
		"server_v2", "minipc", "pc", "sbc", "nas", "router", "switch", "firewall",
		"access_point", "modem", "ups", "pdu", "rack", "console", "iot",
	},
	KindComponent: {"ram", "disk", "gpu", "nic", "hba", "cpu"},
	KindAccessory: {"dac", "sfp", "cable", "rack_shelf", "power_adapter", "other"},
}

var statuses = []string{StatusAvailable, StatusInUse, StatusReserved, StatusBroken, StatusSold}
var locations = []string{"rack", "shelf", "drawer", "storage", "other"}

// State says how an item stands. The status in the list is what the owner
// wrote down; what is known for a fact comes first. An item is in use when it
// is the machine behind a host an integration reads, or when a build plans
// every unit of it. Broken and sold are the owner's word and stay.
//
// plannedUnits is the most units any one build plans: builds may be variants
// of each other, so two of them planning the same machine use it once.
func State(status string, quantity, plannedUnits int, deployed bool) string {
	switch status {
	case StatusAvailable, "":
		if deployed || (plannedUnits > 0 && plannedUnits >= quantity) {
			return StatusInUse
		}
		return StatusAvailable
	case StatusReserved:
		// Reserved for a plan is still reserved; a running hypervisor is not.
		if deployed {
			return StatusInUse
		}
	}
	return status
}

// componentNodeTypes maps an owned component to the internal component it is
// inside a host on the canvas. A CPU has no such form: it is kept, not placed.
var componentNodeTypes = map[string]string{
	"ram": "ram", "disk": "disk", "gpu": "gpu", "nic": "pcie", "hba": "hba",
}

var macPattern = regexp.MustCompile(`^([0-9A-F]{2}:){5}[0-9A-F]{2}$`)

// Specs are the figures of an item. Every field is optional. For a component
// they describe one unit: a kit of two 16 GB modules is ram_gb 16, quantity 2.
type Specs struct {
	CPUModel    string  `json:"cpu_model,omitempty"`
	CPUCores    int     `json:"cpu_cores,omitempty"`
	CPUThreads  int     `json:"cpu_threads,omitempty"`
	RAMGB       float64 `json:"ram_gb,omitempty"`
	RAMType     string  `json:"ram_type,omitempty"` // "DDR4 SODIMM"
	StorageGB   float64 `json:"storage_gb,omitempty"`
	StorageType string  `json:"storage_type,omitempty"` // "NVMe", "SATA SSD", "HDD"
	Ports       int     `json:"ports,omitempty"`
	PortSpeed   string  `json:"port_speed,omitempty"` // "1 GbE"
	RackUnits   int     `json:"rack_units,omitempty"`
	RackSize    int     `json:"rack_size,omitempty"` // a rack: how many units it holds
}

// Item is an inventory item as a user enters it.
type Item struct {
	Kind         string
	Type         string
	Name         string
	Manufacturer string
	Model        string
	Quantity     int
	Status       string
	Location     string
	Specs        Specs
	MacAddresses []string
	PowerDraw    float64
	Notes        string
}

// Types lists the types of a kind, in the order they are offered.
func Types(kind string) []string {
	return append([]string(nil), typesByKind[kind]...)
}

// ComponentNodeType is the internal component type an owned component becomes
// inside a host, and whether it has one.
func ComponentNodeType(itemType string) (string, bool) {
	nodeType, ok := componentNodeTypes[itemType]
	return nodeType, ok
}

func contains(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}

func cleanText(field, value string, limit int) (string, error) {
	text := strings.TrimSpace(value)
	if strings.ContainsRune(text, 0) {
		return "", fmt.Errorf("%w: %s contains a character that cannot be stored", ErrInvalid, field)
	}
	if len([]rune(text)) > limit {
		return "", fmt.Errorf("%w: %s is too long (%d characters at most)", ErrInvalid, field, limit)
	}
	return text, nil
}

func checkWhole(field string, value, high int) error {
	if value < 0 || value > high {
		return fmt.Errorf("%w: %s must be between 0 and %d", ErrInvalid, field, high)
	}
	return nil
}

func checkAmount(field string, value, high float64) error {
	if math.IsNaN(value) || math.IsInf(value, 0) || value < 0 || value > high {
		return fmt.Errorf("%w: %s must be between 0 and %v", ErrInvalid, field, high)
	}
	return nil
}

// NormalizeMAC writes a hardware address the one way it is stored and
// compared: upper case, colons. It reports whether the value is an address.
func NormalizeMAC(value string) (string, bool) {
	mac := strings.ToUpper(strings.TrimSpace(value))
	mac = strings.ReplaceAll(mac, "-", ":")
	return mac, macPattern.MatchString(mac)
}

// Normalize validates an item and returns it the way it is stored. Missing
// choices get the plain default (one unit, available, kept "other" place).
func (item Item) Normalize() (Item, error) {
	out := item
	out.Kind = strings.ToLower(strings.TrimSpace(item.Kind))
	if out.Kind == "" {
		out.Kind = KindDevice
	}
	types, known := typesByKind[out.Kind]
	if !known {
		return Item{}, fmt.Errorf("%w: kind must be device, component or accessory", ErrInvalid)
	}
	out.Type = strings.ToLower(strings.TrimSpace(item.Type))
	if !contains(types, out.Type) {
		return Item{}, fmt.Errorf("%w: a %s cannot be of type %q; use one of %s", ErrInvalid, out.Kind, out.Type, strings.Join(types, ", "))
	}

	var err error
	if out.Name, err = cleanText("name", item.Name, maxNameLength); err != nil {
		return Item{}, err
	}
	if out.Name == "" {
		return Item{}, fmt.Errorf("%w: name is required", ErrInvalid)
	}
	if out.Manufacturer, err = cleanText("manufacturer", item.Manufacturer, maxTextLength); err != nil {
		return Item{}, err
	}
	if out.Model, err = cleanText("model", item.Model, maxTextLength); err != nil {
		return Item{}, err
	}
	if out.Notes, err = cleanText("notes", item.Notes, maxNotesLength); err != nil {
		return Item{}, err
	}

	if out.Quantity == 0 {
		out.Quantity = 1
	}
	if out.Quantity < 1 || out.Quantity > maxQuantity {
		return Item{}, fmt.Errorf("%w: quantity must be between 1 and %d", ErrInvalid, maxQuantity)
	}
	// A device is one machine: two of the same are two items, each with its
	// own state, place and addresses.
	if out.Kind == KindDevice && out.Quantity != 1 {
		return Item{}, fmt.Errorf("%w: a device is one item; add the second machine as an item of its own", ErrInvalid)
	}

	out.Status = strings.ToLower(strings.TrimSpace(item.Status))
	if out.Status == "" {
		out.Status = StatusAvailable
	}
	if !contains(statuses, out.Status) {
		return Item{}, fmt.Errorf("%w: status must be one of %s", ErrInvalid, strings.Join(statuses, ", "))
	}
	out.Location = strings.ToLower(strings.TrimSpace(item.Location))
	if out.Location == "" {
		out.Location = "other"
	}
	if !contains(locations, out.Location) {
		return Item{}, fmt.Errorf("%w: location must be one of %s", ErrInvalid, strings.Join(locations, ", "))
	}

	specs := item.Specs
	if specs.CPUModel, err = cleanText("cpu_model", specs.CPUModel, maxTextLength); err != nil {
		return Item{}, err
	}
	if specs.RAMType, err = cleanText("ram_type", specs.RAMType, 40); err != nil {
		return Item{}, err
	}
	if specs.StorageType, err = cleanText("storage_type", specs.StorageType, 40); err != nil {
		return Item{}, err
	}
	if specs.PortSpeed, err = cleanText("port_speed", specs.PortSpeed, 40); err != nil {
		return Item{}, err
	}
	for field, value := range map[string]struct{ value, high int }{
		"cpu_cores": {specs.CPUCores, 1024}, "cpu_threads": {specs.CPUThreads, 2048},
		"ports": {specs.Ports, 128}, "rack_units": {specs.RackUnits, 60}, "rack_size": {specs.RackSize, 60},
	} {
		if err := checkWhole(field, value.value, value.high); err != nil {
			return Item{}, err
		}
	}
	if err := checkAmount("ram_gb", specs.RAMGB, 16384); err != nil {
		return Item{}, err
	}
	if err := checkAmount("storage_gb", specs.StorageGB, 4_000_000); err != nil {
		return Item{}, err
	}
	if specs.CPUThreads > 0 && specs.CPUCores > specs.CPUThreads {
		return Item{}, fmt.Errorf("%w: a processor cannot have more cores than threads", ErrInvalid)
	}
	out.Specs = specs

	if err := checkAmount("power_draw", item.PowerDraw, 100000); err != nil {
		return Item{}, err
	}

	seen := map[string]bool{}
	out.MacAddresses = []string{}
	for _, raw := range item.MacAddresses {
		if strings.TrimSpace(raw) == "" {
			continue
		}
		mac, ok := NormalizeMAC(raw)
		if !ok {
			return Item{}, fmt.Errorf("%w: %q is not a MAC address (AA:BB:CC:DD:EE:FF)", ErrInvalid, strings.TrimSpace(raw))
		}
		if !seen[mac] {
			seen[mac] = true
			out.MacAddresses = append(out.MacAddresses, mac)
		}
	}
	if len(out.MacAddresses) > maxMACs {
		return Item{}, fmt.Errorf("%w: at most %d MAC addresses per item", ErrInvalid, maxMACs)
	}
	sort.Strings(out.MacAddresses)
	return out, nil
}

// LogicalCPUs is what a host offers its guests: threads where they are known,
// cores otherwise. It is the number the canvas keeps in details.cpu.
func (s Specs) LogicalCPUs() int {
	if s.CPUThreads > 0 {
		return s.CPUThreads
	}
	return s.CPUCores
}

// ModelLine names the hardware in one line: manufacturer and model, and the
// processor where that says more than the box does.
func (item Item) ModelLine() string {
	box := strings.TrimSpace(item.Manufacturer + " " + item.Model)
	switch {
	case box != "" && item.Specs.CPUModel != "":
		return box + " (" + item.Specs.CPUModel + ")"
	case box != "":
		return box
	default:
		return item.Specs.CPUModel
	}
}

// NodeDetails are the details a node gets when it stands for this item on the
// canvas. itemID links the node to the physical asset; the name it carries is
// the role in that build and can be changed freely.
//
// frontend/src/features/inventory/lib/inventory.ts (inventoryItemToDragData)
// builds the same object when an item is dragged onto the canvas. Change them
// together.
func (item Item) NodeDetails(itemID string) map[string]any {
	details := map[string]any{DetailItemID: itemID, DetailLabel: item.Name}
	if model := item.ModelLine(); model != "" {
		details["model"] = model
	}
	specs := item.Specs
	if cpus := specs.LogicalCPUs(); cpus > 0 {
		details["cpu"] = cpus
	}
	if specs.RAMGB > 0 {
		details["ram"] = specs.RAMGB
	}
	if specs.RAMType != "" {
		details["ram_type"] = specs.RAMType
	}
	if specs.StorageGB > 0 {
		details["storage"] = specs.StorageGB
	}
	if specs.Ports > 0 {
		details["ports"] = specs.Ports
	}
	if specs.RackUnits > 0 {
		details["rack_units"] = specs.RackUnits
	}
	if item.Type == "rack" && specs.RackSize > 0 {
		details["rack_size"] = specs.RackSize
	}
	return details
}
