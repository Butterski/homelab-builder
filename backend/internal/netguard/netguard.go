// Package netguard decides which addresses the server may call on behalf of a
// user.
//
// A user chooses an endpoint the server then calls for them: a model provider,
// a Proxmox host. On a shared instance that must never become a way to reach
// the server's own network: cloud metadata services, the database, other
// containers. The checks run on the address a connection is actually made to,
// after DNS resolution, so a hostname that resolves to an internal address (or
// is re-pointed between the check and the request) is refused as well.
package netguard

import (
	"errors"
	"fmt"
	"net"
	"strings"
	"syscall"
)

// ErrPrivateEndpoint means an endpoint resolved to an address the instance may not call.
var ErrPrivateEndpoint = errors.New("endpoint address is not allowed on this instance")

var blockedNetworks = mustParseCIDRs(
	"0.0.0.0/8",     // "this network"
	"100.64.0.0/10", // carrier-grade NAT, also used by cloud-internal services
	"192.0.0.0/24",  // IETF protocol assignments
	"198.18.0.0/15", // benchmarking
	"240.0.0.0/4",   // reserved
	"64:ff9b::/96",  // NAT64, maps onto IPv4 space
	"2001:db8::/32", // documentation
)

func mustParseCIDRs(cidrs ...string) []*net.IPNet {
	networks := make([]*net.IPNet, 0, len(cidrs))
	for _, cidr := range cidrs {
		_, network, err := net.ParseCIDR(cidr)
		if err != nil {
			panic(err)
		}
		networks = append(networks, network)
	}
	return networks
}

// IsPublicAddress reports whether ip is a routable public address: not
// loopback, private, link-local (which includes cloud metadata at
// 169.254.169.254), unique-local, multicast or otherwise reserved.
func IsPublicAddress(ip net.IP) bool {
	if ip == nil {
		return false
	}
	if v4 := ip.To4(); v4 != nil {
		ip = v4
	}
	if ip.IsLoopback() || ip.IsPrivate() || ip.IsUnspecified() ||
		ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() ||
		ip.IsMulticast() || ip.IsInterfaceLocalMulticast() {
		return false
	}
	for _, network := range blockedNetworks {
		if network.Contains(ip) {
			return false
		}
	}
	return true
}

// IsInternalHostname reports names that can only point inside a network. It is
// a courtesy for a clear message up front; DialControl enforces the rule on the
// resolved address whatever the name is.
func IsInternalHostname(host string) bool {
	lower := strings.ToLower(strings.TrimSuffix(host, "."))
	return lower == "localhost" || strings.HasSuffix(lower, ".localhost") ||
		strings.HasSuffix(lower, ".local") || strings.HasSuffix(lower, ".internal")
}

// DialControl is a net.Dialer.Control function. Unless allowPrivate is set it
// refuses every connection to a non-public address.
func DialControl(allowPrivate bool) func(network, address string, conn syscall.RawConn) error {
	return func(_, address string, _ syscall.RawConn) error {
		if allowPrivate {
			return nil
		}
		host, _, err := net.SplitHostPort(address)
		if err != nil {
			return err
		}
		if !IsPublicAddress(net.ParseIP(host)) {
			return fmt.Errorf("%w: %s", ErrPrivateEndpoint, host)
		}
		return nil
	}
}
