package services

import (
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net"
	"sort"
	"strconv"
	"strings"

	"github.com/Butterski/homelab-builder/backend/internal/models"
	"github.com/google/uuid"
)

// ── Catalog shortcuts ───────────────────────────────────────────────────────

func (ed *topologyEditor) catalogHardware(token string) (*models.HardwareComponent, error) {
	id, err := uuid.Parse(strings.TrimSpace(token))
	if err != nil {
		return nil, errors.New("hardware_id must be an id returned by search_hardware")
	}
	if ed.opts.Catalog == nil {
		return nil, errors.New("the hardware catalog is not available")
	}
	hardware, err := ed.opts.Catalog.HardwareByID(id)
	if err != nil || hardware == nil {
		return nil, fmt.Errorf("hardware_id %s is not in the catalog; look it up with search_hardware", id)
	}
	return hardware, nil
}

func (ed *topologyEditor) catalogService(token string) (*models.Service, error) {
	id, err := uuid.Parse(strings.TrimSpace(token))
	if err != nil {
		return nil, errors.New("catalog_service_id must be an id returned by list_services")
	}
	if ed.opts.Catalog == nil {
		return nil, errors.New("the service catalog is not available")
	}
	service, err := ed.opts.Catalog.ServiceForUser(id, ed.opts.UserID)
	if err != nil || service == nil {
		return nil, fmt.Errorf("catalog_service_id %s is not in the catalog; look it up with list_services", id)
	}
	return service, nil
}

// catalogHardwareDetails maps a catalog item to node details the way dropping
// it on the canvas does (catalog-mapper.ts: hardwareComponentToDragData).
func catalogHardwareDetails(hardware *models.HardwareComponent) (map[string]any, float64) {
	spec := map[string]any{}
	if len(hardware.Spec) > 0 {
		_ = json.Unmarshal(hardware.Spec, &spec)
	}
	details := map[string]any{
		"model":     strings.TrimSpace(hardware.Brand + " " + hardware.Model),
		"price_est": hardware.PriceEst,
		"currency":  hardware.Currency,
	}
	for key, value := range spec {
		if !reservedDetailKeys[key] && !strings.HasPrefix(key, "blueprint_") {
			details[key] = value
		}
	}
	cpuSource := spec["cpu"]
	if cpuSource == nil {
		cpuSource = spec["cpu_cores"]
	}
	if cores := parseCoreCount(cpuSource); cores > 0 {
		details["cpu"] = cores
	}
	if ram := parseCapacityGB(spec["ram"]); ram > 0 {
		details["ram"] = ram
	}
	storageSource := spec["storage"]
	if storageSource == nil {
		storageSource = spec["capacity"]
	}
	if storage := parseCapacityGB(storageSource); storage > 0 {
		details["storage"] = storage
	}
	if ports, ok := ParsePortCount(spec["ports"]); ok {
		details["ports"] = ports
	}
	if units, ok := parseRackUnits(spec); ok {
		details["rack_units"] = units
	}
	power := hardware.PowerDraw
	if tdp, ok := spec["tdp_w"].(float64); ok && tdp > 0 {
		power = tdp
	}
	return details, power
}

func parseRackUnits(spec map[string]any) (int, bool) {
	for _, key := range []string{"rack_units", "units"} {
		switch v := spec[key].(type) {
		case float64:
			if v >= 1 {
				return int(v), true
			}
		case string:
			if n, err := strconv.Atoi(strings.TrimSpace(v)); err == nil && n >= 1 {
				return n, true
			}
		}
	}
	if formFactor, ok := spec["form_factor"].(string); ok {
		if match := rackUnitPattern.FindStringSubmatch(formFactor); match != nil {
			n, _ := strconv.Atoi(match[1])
			return n, n >= 1
		}
	}
	return 0, false
}

// ── Field validation ────────────────────────────────────────────────────────

// mergeDetails applies a merge patch: a null value removes the key. Keys the
// canvas computes are rejected, and known keys must have the type it renders.
func mergeDetails(details map[string]any, patch map[string]any, nodeType string) error {
	keys := make([]string, 0, len(patch))
	for key := range patch {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	for _, key := range keys {
		value := patch[key]
		if key == "" || len(key) > 64 {
			return errors.New("details keys must be 1-64 characters")
		}
		if reservedDetailKeys[key] || strings.HasPrefix(key, "blueprint_") {
			return fmt.Errorf("details.%s is managed by the builder and cannot be set", key)
		}
		if value == nil {
			delete(details, key)
			continue
		}
		cleaned, err := cleanDetailValue(key, value, nodeType)
		if err != nil {
			return err
		}
		details[key] = cleaned
	}
	if len(details) > maxDetailKeys {
		return fmt.Errorf("details can hold at most %d keys", maxDetailKeys)
	}
	return nil
}

func cleanDetailValue(key string, value any, nodeType string) (any, error) {
	if numberDetailKeys[key] {
		number, ok := asNumber(value)
		if !ok || math.IsNaN(number) || math.IsInf(number, 0) || number < 0 {
			return nil, fmt.Errorf("details.%s must be a non-negative number", key)
		}
		switch key {
		case "ports":
			if number < 1 || number > 128 || number != math.Trunc(number) {
				return nil, errors.New("details.ports must be a whole number from 1 to 128")
			}
		case "rack_size":
			if nodeType != "rack" {
				return nil, errors.New("details.rack_size only applies to rack nodes")
			}
			if number < 1 || number > maxRackSizeU || number != math.Trunc(number) {
				return nil, fmt.Errorf("details.rack_size must be a whole number from 1 to %d", maxRackSizeU)
			}
		case "rack_units":
			if number < 1 || number > maxRackSizeU || number != math.Trunc(number) {
				return nil, fmt.Errorf("details.rack_units must be a whole number from 1 to %d", maxRackSizeU)
			}
		}
		return number, nil
	}
	if boolDetailKeys[key] {
		flag, ok := value.(bool)
		if !ok {
			return nil, fmt.Errorf("details.%s must be true or false", key)
		}
		return flag, nil
	}
	if allowed, ok := enumDetailKeys[key]; ok {
		text, _ := value.(string)
		return cleanEnum("details."+key, text, allowed)
	}
	switch key {
	case "public_ip":
		text, _ := value.(string)
		if text = strings.TrimSpace(text); !isIPv4(text) {
			return nil, errors.New("details.public_ip must be an IPv4 address")
		}
		return text, nil
	case "subnet_mask":
		text, _ := value.(string)
		if text = strings.TrimSpace(text); !isSubnetMask(text) {
			return nil, errors.New("details.subnet_mask must be a dotted mask such as 255.255.255.0 or a prefix length such as 24")
		}
		return text, nil
	}
	switch v := value.(type) {
	case string:
		if len(v) > maxDetailStringLength {
			return nil, fmt.Errorf("details.%s is too long (%d characters at most)", key, maxDetailStringLength)
		}
		return v, nil
	case bool:
		return v, nil
	}
	if number, ok := asNumber(value); ok {
		if math.IsNaN(number) || math.IsInf(number, 0) {
			return nil, fmt.Errorf("details.%s must be a finite number", key)
		}
		return number, nil
	}
	return nil, fmt.Errorf("details.%s must be text, a number or true/false", key)
}

func asNumber(value any) (float64, bool) {
	switch v := value.(type) {
	case float64:
		return v, true
	case float32:
		return float64(v), true
	case int:
		return float64(v), true
	case int64:
		return float64(v), true
	}
	return 0, false
}

func cleanName(value, fallback string) (string, error) {
	name := strings.TrimSpace(value)
	if name == "" {
		name = fallback
	}
	if name == "" {
		return "", errors.New("name is required")
	}
	if len([]rune(name)) > maxNameLength {
		return "", fmt.Errorf("name is too long (%d characters at most)", maxNameLength)
	}
	return name, nil
}

func cleanText(field, value string, limit int) (string, error) {
	text := strings.TrimSpace(value)
	if len([]rune(text)) > limit {
		return "", fmt.Errorf("%s is too long (%d characters at most)", field, limit)
	}
	return text, nil
}

func cleanEnum(field, value string, allowed []string) (string, error) {
	normalized := strings.ToLower(strings.TrimSpace(value))
	if stringInList(allowed, normalized) {
		return normalized, nil
	}
	return "", fmt.Errorf("%s must be one of %s", field, strings.Join(allowed, ", "))
}

func checkRange(field string, value, low, high float64) error {
	if math.IsNaN(value) || value < low || value > high {
		return fmt.Errorf("%s must be between %v and %v", field, low, high)
	}
	return nil
}

func isIPv4(value string) bool {
	return net.ParseIP(value).To4() != nil && strings.Count(value, ".") == 3
}

func isSubnetMask(value string) bool {
	if prefix, err := strconv.Atoi(value); err == nil {
		return prefix >= 1 && prefix <= 32
	}
	ip := net.ParseIP(value).To4()
	if ip == nil {
		return false
	}
	ones, bits := net.IPMask(ip).Size()
	return bits == 32 && ones > 0
}

func stringInList(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}

func joinKeys(set map[string]bool) string {
	keys := make([]string, 0, len(set))
	for key := range set {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return strings.Join(keys, ", ")
}
