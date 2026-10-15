package wiring

import (
	"errors"
	"fmt"
	"net/netip"
	"regexp"
	"sort"
	"strings"
	"unicode/utf8"
)

const (
	maxVLANs        = 64
	maxTaggedVLANs  = 64
	maxCommentRunes = 80
	maxVLANName     = 32
	minVLANID       = 1
	maxVLANID       = 4094
)

var (
	colorPattern = regexp.MustCompile(`^#[0-9a-fA-F]{6}$`)
	validRoles   = map[string]bool{"wan": true, "lan": true, "dmz": true, "vpn": true, "unused": true}
)

// PortSettings is what the user set for one port in details.port_config.
type PortSettings struct {
	Role, Address string
	DHCP          bool
	UntaggedVLAN  int
	TaggedVLANs   []int
	Comment       string
}

// VLAN is one VLAN definition of a switch (details.vlans).
type VLAN struct {
	ID                  int
	Name, Color, Subnet string
}

// hasPortSettings is true for the types that keep per-port settings.
func hasPortSettings(nodeType string) bool {
	return nodeType == "router" || nodeType == "firewall" || nodeType == "switch"
}

func isGateway(nodeType string) bool {
	return nodeType == "router" || nodeType == "firewall"
}

// DefaultRole is the role a router or firewall port has when none is set:
// the uplink on top is the WAN, the numbered ports are LAN.
func DefaultRole(handle string) string {
	if handle == "target-0" {
		return "wan"
	}
	return "lan"
}

// ReadPortConfig reads details.port_config, skipping what cannot be read.
func ReadPortConfig(details map[string]any) map[string]PortSettings {
	raw, _ := details["port_config"].(map[string]any)
	out := make(map[string]PortSettings, len(raw))
	for handle, value := range raw {
		entry, ok := value.(map[string]any)
		if !ok {
			continue
		}
		var settings PortSettings
		settings.Role, _ = entry["role"].(string)
		settings.Address, _ = entry["address"].(string)
		settings.DHCP, _ = entry["dhcp"].(bool)
		settings.UntaggedVLAN, _ = integer(entry["untagged_vlan"])
		settings.Comment, _ = entry["comment"].(string)
		if list, ok := entry["tagged_vlans"].([]any); ok {
			for _, item := range list {
				if id, ok := integer(item); ok {
					settings.TaggedVLANs = append(settings.TaggedVLANs, id)
				}
			}
		} else if list, ok := entry["tagged_vlans"].([]int); ok {
			settings.TaggedVLANs = append([]int(nil), list...)
		}
		out[handle] = settings
	}
	return out
}

// ReadVLANs reads details.vlans, skipping entries without a whole id.
func ReadVLANs(details map[string]any) []VLAN {
	list, _ := details["vlans"].([]any)
	out := make([]VLAN, 0, len(list))
	for _, value := range list {
		entry, ok := value.(map[string]any)
		if !ok {
			continue
		}
		id, ok := integer(entry["id"])
		if !ok {
			continue
		}
		vlan := VLAN{ID: id}
		vlan.Name, _ = entry["name"].(string)
		vlan.Color, _ = entry["color"].(string)
		vlan.Subnet, _ = entry["subnet"].(string)
		out = append(out, vlan)
	}
	return out
}

// portIndex is N for "ethN", -1 for any other handle.
func portIndex(handle string) int {
	rest, ok := strings.CutPrefix(handle, "eth")
	if !ok {
		return -1
	}
	return plainIndex(rest)
}

// ValidatePortConfig checks details.port_config against the rules for the
// node type and its port count.
func ValidatePortConfig(nodeType string, details map[string]any, portCount int) error {
	value, present := details["port_config"]
	if !present || value == nil {
		return nil
	}
	if !hasPortSettings(nodeType) {
		return errors.New("only routers, firewalls and switches have port settings")
	}
	config, ok := value.(map[string]any)
	if !ok {
		return errors.New("port_config must be an object keyed by port")
	}
	defined := map[int]bool{}
	for _, vlan := range ReadVLANs(details) {
		defined[vlan.ID] = true
	}
	handles := make([]string, 0, len(config))
	for handle := range config {
		handles = append(handles, handle)
	}
	sort.Strings(handles)
	for _, handle := range handles {
		if handle != "target-0" {
			if n := portIndex(handle); n < 0 || n >= portCount {
				return fmt.Errorf("port %s does not exist (%d ports)", handle, portCount)
			}
		}
		entry, ok := config[handle].(map[string]any)
		if !ok {
			return fmt.Errorf("the settings of port %s must be an object", handle)
		}
		if err := validatePortEntry(nodeType, entry, defined); err != nil {
			return fmt.Errorf("port %s: %w", handle, err)
		}
	}
	return nil
}

func validatePortEntry(nodeType string, entry map[string]any, defined map[int]bool) error {
	gateway := isGateway(nodeType)
	keys := make([]string, 0, len(entry))
	for key := range entry {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	for _, key := range keys {
		value := entry[key]
		switch key {
		case "role":
			role, _ := value.(string)
			if !gateway {
				return errors.New("only router and firewall ports have a role")
			}
			if !validRoles[role] {
				return fmt.Errorf("role must be wan, lan, dmz, vpn or unused, not %v", value)
			}
		case "address":
			address, _ := value.(string)
			if !gateway {
				return errors.New("only router and firewall ports have an address")
			}
			if !IsIPv4CIDR(address) {
				return fmt.Errorf("address %v must be an IPv4 address with a prefix of 8 to 30, such as 192.168.10.1/24, and not the network or broadcast address", value)
			}
		case "dhcp":
			if !gateway {
				return errors.New("only router and firewall ports run DHCP")
			}
			if _, ok := value.(bool); !ok {
				return errors.New("dhcp must be true or false")
			}
		case "untagged_vlan":
			id, ok := integer(value)
			if !ok || id < minVLANID || id > maxVLANID {
				return fmt.Errorf("untagged_vlan must be a VLAN id from 1 to 4094, not %v", value)
			}
			if nodeType == "switch" && !defined[id] {
				return fmt.Errorf("VLAN %d is not defined on this switch", id)
			}
		case "tagged_vlans":
			if nodeType != "switch" {
				return errors.New("only switch ports carry tagged VLANs")
			}
			if err := validateTagged(value, defined); err != nil {
				return err
			}
		case "comment":
			comment, ok := value.(string)
			if !ok {
				return errors.New("comment must be text")
			}
			if utf8.RuneCountInString(comment) > maxCommentRunes {
				return fmt.Errorf("comment is longer than %d characters", maxCommentRunes)
			}
		default:
			return fmt.Errorf("unknown port setting %q", key)
		}
	}
	return nil
}

func validateTagged(value any, defined map[int]bool) error {
	var items []any
	switch list := value.(type) {
	case []any:
		items = list
	case []int:
		for _, id := range list {
			items = append(items, id)
		}
	default:
		return errors.New("tagged_vlans must be a list of VLAN ids")
	}
	if len(items) > maxTaggedVLANs {
		return fmt.Errorf("a port carries at most %d tagged VLANs", maxTaggedVLANs)
	}
	seen := map[int]bool{}
	for _, item := range items {
		id, ok := integer(item)
		if !ok || id < minVLANID || id > maxVLANID {
			return fmt.Errorf("tagged VLAN %v must be an id from 1 to 4094", item)
		}
		if seen[id] {
			return fmt.Errorf("tagged VLAN %d is listed twice", id)
		}
		seen[id] = true
		if !defined[id] {
			return fmt.Errorf("VLAN %d is not defined on this switch", id)
		}
	}
	return nil
}

// ValidateVLANs checks details.vlans: switches only, at most 64, unique ids
// 1..4094, names of 1 to 32 characters, colours as #rrggbb, IPv4 subnets.
func ValidateVLANs(nodeType string, details map[string]any) error {
	value, present := details["vlans"]
	if !present || value == nil {
		return nil
	}
	if nodeType != "switch" {
		return errors.New("only switches define VLANs")
	}
	list, ok := value.([]any)
	if !ok {
		return errors.New("vlans must be a list")
	}
	if len(list) > maxVLANs {
		return fmt.Errorf("a switch defines at most %d VLANs", maxVLANs)
	}
	seen := map[int]bool{}
	for _, item := range list {
		entry, ok := item.(map[string]any)
		if !ok {
			return errors.New("each VLAN must be an object")
		}
		id, ok := integer(entry["id"])
		if !ok || id < minVLANID || id > maxVLANID {
			return fmt.Errorf("VLAN id %v must be a number from 1 to 4094", entry["id"])
		}
		if seen[id] {
			return fmt.Errorf("VLAN %d is defined twice", id)
		}
		seen[id] = true
		for key, field := range entry {
			switch key {
			case "id":
			case "name":
				name, _ := field.(string)
				if length := utf8.RuneCountInString(strings.TrimSpace(name)); length == 0 || utf8.RuneCountInString(name) > maxVLANName {
					return fmt.Errorf("VLAN %d needs a name of 1 to %d characters", id, maxVLANName)
				}
			case "color":
				color, _ := field.(string)
				if !colorPattern.MatchString(color) {
					return fmt.Errorf("VLAN %d colour must look like #3b82f6", id)
				}
			case "subnet":
				subnet, _ := field.(string)
				if !IsIPv4Subnet(subnet) {
					return fmt.Errorf("VLAN %d subnet must be an IPv4 subnet with a prefix of 8 to 30, such as 192.168.10.0/24", id)
				}
			default:
				return fmt.Errorf("VLAN %d has an unknown setting %q", id, key)
			}
		}
		if _, named := entry["name"]; !named {
			return fmt.Errorf("VLAN %d needs a name of 1 to %d characters", id, maxVLANName)
		}
	}
	return nil
}

// parseIPv4Prefix parses "a.b.c.d/p" with a prefix of 8 to 30.
func parseIPv4Prefix(text string) (netip.Prefix, bool) {
	prefix, err := netip.ParsePrefix(text)
	if err != nil || !prefix.Addr().Is4() || prefix.Bits() < 8 || prefix.Bits() > 30 {
		return netip.Prefix{}, false
	}
	// ParsePrefix also accepts a leading-zero prefix length such as /024.
	if _, bits, _ := strings.Cut(text, "/"); len(bits) > 1 && bits[0] == '0' {
		return netip.Prefix{}, false
	}
	return prefix, true
}

// IsIPv4CIDR reports whether text is an interface address such as
// 192.168.10.1/24: prefix 8 to 30, neither the network nor the broadcast address.
func IsIPv4CIDR(text string) bool {
	prefix, ok := parseIPv4Prefix(text)
	if !ok {
		return false
	}
	addr := prefix.Addr().As4()
	value := uint32(addr[0])<<24 | uint32(addr[1])<<16 | uint32(addr[2])<<8 | uint32(addr[3])
	hostMask := uint32(1)<<(32-prefix.Bits()) - 1
	host := value & hostMask
	return host != 0 && host != hostMask
}

// IsIPv4Subnet reports whether text is an IPv4 subnet with a prefix of 8 to
// 30; the host part may be anything, so 192.168.10.0/24 is fine.
func IsIPv4Subnet(text string) bool {
	_, ok := parseIPv4Prefix(text)
	return ok
}

// PrunePortConfig drops the settings of ports that no longer exist and
// removes port_config once nothing is left in it.
func PrunePortConfig(details map[string]any, portCount int) {
	config, ok := details["port_config"].(map[string]any)
	if !ok {
		return
	}
	for handle := range config {
		if n := portIndex(handle); n >= 0 && n >= portCount {
			delete(config, handle)
		}
	}
	if len(config) == 0 {
		delete(details, "port_config")
	}
}

// VLANSet is the sorted list of VLANs a port carries: its untagged VLAN on a
// router, firewall or switch, plus the tagged VLANs of a switch port. It is
// nil when the port carries none.
func VLANSet(nodeType string, details map[string]any, handle string) []int {
	if !hasPortSettings(nodeType) {
		return nil
	}
	settings, ok := ReadPortConfig(details)[handle]
	if !ok {
		return nil
	}
	seen := map[int]bool{}
	var out []int
	add := func(id int) {
		if id >= minVLANID && id <= maxVLANID && !seen[id] {
			seen[id] = true
			out = append(out, id)
		}
	}
	add(settings.UntaggedVLAN)
	if nodeType == "switch" {
		for _, id := range settings.TaggedVLANs {
			add(id)
		}
	}
	sort.Ints(out)
	return out
}
