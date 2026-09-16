package core

import (
	"net"

	"github.com/Butterski/hlbipam/internal/utils"
)

type SubnetAllocator struct {
	Network   uint32
	Capacity  uint32
	Mask      uint32
	Gateway   uint32
	Used      map[uint32]bool
	DHCPStart uint32
	DHCPEnd   uint32
	Zones     map[string]ZoneConfig
}

func NewSubnetAllocator(subnetStr string, gatewayIP string, zones map[string]ZoneConfig, reqDHCPEnabled bool) *SubnetAllocator {
	network, capacity, mask, err := utils.ParseCIDR(subnetStr)
	if err != nil {
		network, capacity, mask, _ = utils.ParseCIDR(gatewayIP + "/24")
	}

	gwUint := utils.IPToUint32(net.ParseIP(gatewayIP))
	sa := &SubnetAllocator{
		Network:  network,
		Capacity: capacity,
		Mask:     mask,
		Gateway:  gwUint,
		Used:     make(map[uint32]bool),
		Zones:    zones,
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

func (sa *SubnetAllocator) Reserve(ipUint uint32) bool {
	if !sa.IsAvailable(ipUint) {
		return false
	}
	sa.Used[ipUint] = true
	return true
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
	return utils.Uint32ToIP(ipUint)
}
