package models

// ── Request DTOs ──

// AllocateRequest is the input for POST /api/v1/allocate and POST /api/v1/validate.
type AllocateRequest struct {
	Routers     []RouterDTO             `json:"routers"`
	Nodes       []NodeDTO               `json:"nodes"`
	CustomZones map[string]ZoneOverride `json:"custom_zones,omitempty"`
}

type RouterDTO struct {
	ID          string `json:"id"`
	GatewayIP   string `json:"gateway_ip,omitempty"`
	Subnet      string `json:"subnet,omitempty"`
	DHCPEnabled bool   `json:"dhcp_enabled,omitempty"`
}

type NodeDTO struct {
	ID          string   `json:"id"`
	Type        string   `json:"type"`
	Connections []string `json:"connections"`
	ExistingIP  string   `json:"existing_ip,omitempty"`
	VMs         []VMDTO  `json:"vms,omitempty"`
	// DHCPClients is the number of leases this node needs for devices behind it
	// that are not listed themselves: seats at a LAN table, Wi-Fi clients.
	DHCPClients int `json:"dhcp_clients,omitempty"`
}

type VMDTO struct {
	ID         string `json:"id"`
	ExistingIP string `json:"existing_ip,omitempty"`
}

type ZoneOverride struct {
	BaseOffset int  `json:"base_offset"`
	Step       int  `json:"step"`
	CanHostVMs bool `json:"can_host_vms"`
}

// ── Response DTOs ──

type AllocateResponse struct {
	Routers   []RouterResult `json:"routers"`
	Nodes     []NodeResult   `json:"nodes"`
	Conflicts []Issue        `json:"conflicts"`
	Warnings  []Issue        `json:"warnings"`
}

type RouterResult struct {
	ID        string `json:"id"`
	GatewayIP string `json:"gateway_ip"`
	Subnet    string `json:"subnet"`
	// The DHCP pool carved out of the subnet; empty when DHCP is off.
	DHCPStart string `json:"dhcp_start,omitempty"`
	DHCPEnd   string `json:"dhcp_end,omitempty"`
	DHCPSize  int    `json:"dhcp_size,omitempty"`
	// DHCPClients is the lease demand announced by the nodes of this subnet.
	DHCPClients int `json:"dhcp_clients,omitempty"`
}

type NodeResult struct {
	ID         string     `json:"id"`
	Type       string     `json:"type"`
	AssignedIP string     `json:"assigned_ip"`
	VMs        []VMResult `json:"vms,omitempty"`
}

type VMResult struct {
	ID         string `json:"id"`
	AssignedIP string `json:"assigned_ip"`
}

type ValidateResponse struct {
	Valid    bool    `json:"valid"`
	Errors   []Issue `json:"errors"`
	Warnings []Issue `json:"warnings"`
}

type Issue struct {
	NodeID  string `json:"node_id"`
	Message string `json:"message"`
}
