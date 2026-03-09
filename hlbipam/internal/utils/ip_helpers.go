package utils

import (
	"encoding/binary"
	"fmt"
	"net"
	"strings"
)

func IPToUint32(ip net.IP) uint32 {
	if len(ip) == 16 {
		ip = ip.To4()
	}
	if len(ip) != 4 || ip == nil {
		return 0
	}
	return binary.BigEndian.Uint32(ip)
}

func Uint32ToIP(n uint32) string {
	ip := make(net.IP, 4)
	binary.BigEndian.PutUint32(ip, n)
	return ip.String()
}

func ParseCIDR(subnet string) (network uint32, capacity uint32, mask uint32, err error) {
	parts := strings.Split(subnet, "/")
	if len(parts) == 2 {
		ipStr := parts[0]
		maskStr := parts[1]
		ip := net.ParseIP(ipStr)
		if ip == nil {
			return 0, 0, 0, fmt.Errorf("invalid IP")
		}
		
		var maskIP net.IP
		if strings.Contains(maskStr, ".") {
			maskIP = net.ParseIP(maskStr)
			if maskIP != nil && maskIP.To4() != nil {
				maskUint := IPToUint32(maskIP.To4())
				netIP := IPToUint32(ip.To4()) & maskUint
				cap := ^maskUint
				return netIP, cap, maskUint, nil
			}
		}
	}
	
	ip, ipnet, err := net.ParseCIDR(subnet)
	if err == nil {
		netIP := IPToUint32(ipnet.IP.To4())
		maskUint := IPToUint32(net.IP(ipnet.Mask).To4())
		cap := ^maskUint
		return netIP, cap, maskUint, nil
	}

	ip = net.ParseIP(subnet)
	if ip != nil {
		netIP := IPToUint32(ip.To4()) & 0xFFFFFF00
		return netIP, 255, 0xFFFFFF00, nil
	}
	
	return 0, 0, 0, fmt.Errorf("invalid subnet format: %s", subnet)
}

func IsValidIPv4(ip string) bool {
	parsed := net.ParseIP(ip)
	return parsed != nil && parsed.To4() != nil
}
