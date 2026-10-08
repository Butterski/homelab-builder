package core

import (
	"math"
	"net"
)

type SubnetAllocator struct {
	Network   uint32
	Capacity  uint32
	Used      map[uint32]bool
	DHCPStart uint32
	DHCPEnd   uint32
}

// NewSubnetAllocator prepares a subnet. With DHCP on it carves the lease pool:
// a third of the subnet by default, grown to fit dhcpDemand leases plus
// headroom when the nodes announce more than that.
func NewSubnetAllocator(subnetStr string, gatewayIP string, reqDHCPEnabled bool, dhcpDemand int) *SubnetAllocator {
	network, capacity, _, err := parseCIDR(subnetStr)
	if err != nil {
		network, capacity, _, _ = parseCIDR(gatewayIP + "/24")
	}

	gwUint := ipToUint32(net.ParseIP(gatewayIP))
	sa := &SubnetAllocator{
		Network:  network,
		Capacity: capacity,
		Used:     make(map[uint32]bool),
	}

	sa.Used[network] = true
	if capacity > 0 {
		sa.Used[network+capacity] = true
	}
	if sa.IsUsable(gwUint) {
		sa.Used[gwUint] = true
	}

	if reqDHCPEnabled && capacity > 1 {
		startOffset := uint32(50)
		if capacity < 100 {
			startOffset = capacity / 4
		}
		poolSize := capacity / 3
		if poolSize < 10 {
			poolSize = capacity / 2
		}
		// The pool is inclusive at both ends, so it holds poolSize+1 addresses.
		if needed := uint32(math.Ceil(float64(dhcpDemand) * DHCPHeadroom)); dhcpDemand > 0 && needed > poolSize+1 {
			poolSize = needed - 1
		}

		sa.DHCPStart = network + startOffset
		sa.DHCPEnd = sa.DHCPStart + poolSize
		lastUsable := network + capacity - 1
		if sa.DHCPStart > lastUsable {
			sa.DHCPStart = 0
			sa.DHCPEnd = 0
		} else if sa.DHCPEnd > lastUsable {
			sa.DHCPEnd = lastUsable
		}
	}

	return sa
}

// DHCPPoolSize is the number of addresses in the DHCP pool.
func (sa *SubnetAllocator) DHCPPoolSize() int {
	if sa.DHCPStart == 0 {
		return 0
	}
	return int(sa.DHCPEnd-sa.DHCPStart) + 1
}

func (sa *SubnetAllocator) IsUsable(ipUint uint32) bool {
	if sa.Capacity <= 1 {
		return false
	}
	return ipUint > sa.Network && ipUint < sa.Network+sa.Capacity
}

func (sa *SubnetAllocator) IsDHCPReserved(ipUint uint32) bool {
	return sa.DHCPStart != 0 && ipUint >= sa.DHCPStart && ipUint <= sa.DHCPEnd
}

func (sa *SubnetAllocator) IsAvailable(ipUint uint32) bool {
	return sa.IsUsable(ipUint) && !sa.IsDHCPReserved(ipUint) && !sa.Used[ipUint]
}

func (sa *SubnetAllocator) AllocateSlot(baseOffset int) uint32 {
	if baseOffset < 1 || sa.Capacity <= 1 || uint32(baseOffset) >= sa.Capacity {
		baseOffset = 1
	}
	startIP := sa.Network + uint32(baseOffset)
	for ip := startIP; ip < sa.Network+sa.Capacity; ip++ {
		if sa.IsAvailable(ip) {
			return ip
		}
	}
	for ip := sa.Network + 1; ip < startIP; ip++ {
		if sa.IsAvailable(ip) {
			return ip
		}
	}
	return 0
}

func (sa *SubnetAllocator) FormatIP(ipUint uint32) string {
	return uint32ToIP(ipUint)
}
