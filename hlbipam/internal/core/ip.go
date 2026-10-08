package core

import (
	"encoding/binary"
	"fmt"
	"net"
	"strings"
)

func ipToUint32(ip net.IP) uint32 {
	ip = ip.To4()
	if ip == nil {
		return 0
	}
	return binary.BigEndian.Uint32(ip)
}

func uint32ToIP(n uint32) string {
	ip := make(net.IP, 4)
	binary.BigEndian.PutUint32(ip, n)
	return ip.String()
}

// parseCIDR accepts "a.b.c.d/len", "a.b.c.d/m.m.m.m" and a bare address
// (taken as its /24). capacity is the host part of the mask, so the
// broadcast address is network+capacity.
func parseCIDR(subnet string) (network uint32, capacity uint32, mask uint32, err error) {
	if ipStr, maskStr, ok := strings.Cut(subnet, "/"); ok && strings.Contains(maskStr, ".") {
		ip := net.ParseIP(ipStr)
		if ip == nil {
			return 0, 0, 0, fmt.Errorf("invalid IP")
		}
		if maskIP := net.ParseIP(maskStr).To4(); maskIP != nil {
			maskUint := ipToUint32(maskIP)
			return ipToUint32(ip) & maskUint, ^maskUint, maskUint, nil
		}
	}

	if _, ipnet, err := net.ParseCIDR(subnet); err == nil {
		maskUint := ipToUint32(net.IP(ipnet.Mask))
		return ipToUint32(ipnet.IP), ^maskUint, maskUint, nil
	}

	if ip := net.ParseIP(subnet); ip != nil {
		return ipToUint32(ip) & 0xFFFFFF00, 255, 0xFFFFFF00, nil
	}

	return 0, 0, 0, fmt.Errorf("invalid subnet format: %s", subnet)
}

func isValidIPv4(ip string) bool {
	return net.ParseIP(ip).To4() != nil
}
