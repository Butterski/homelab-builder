package llm

import (
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"strings"
	"syscall"
	"time"
)

// A user chooses the endpoint the server calls for them. On a shared instance
// that must never become a way to reach the server's own network: cloud
// metadata services, the database, other containers. The checks below run on
// the address a connection is actually made to, after DNS resolution, so a
// hostname that resolves to an internal address (or is re-pointed between the
// check and the request) is refused as well.

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

// SafeHTTPClient returns the HTTP client used for provider calls. Unless
// allowPrivate is set, it refuses to connect to any non-public address. It
// ignores proxy environment variables so the check always sees the real target.
func SafeHTTPClient(allowPrivate bool) *http.Client {
	dialer := &net.Dialer{
		Timeout:   15 * time.Second,
		KeepAlive: 30 * time.Second,
		Control: func(_, address string, _ syscall.RawConn) error {
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
		},
	}
	return &http.Client{
		Transport: &http.Transport{
			Proxy:                 nil,
			DialContext:           dialer.DialContext,
			ForceAttemptHTTP2:     true,
			MaxIdleConns:          20,
			IdleConnTimeout:       90 * time.Second,
			TLSHandshakeTimeout:   15 * time.Second,
			ResponseHeaderTimeout: 120 * time.Second,
		},
		// No overall timeout: replies stream for as long as the model writes.
		// Callers bound the request with their context.
	}
}

// ValidateBaseURL checks a user-supplied endpoint and returns it normalised.
// Plain http is only accepted where private endpoints are allowed, which is how
// a local Ollama is reached; a public instance requires https.
func ValidateBaseURL(raw string, allowPrivate bool) (string, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "", errors.New("endpoint address is required")
	}
	if len(raw) > 300 {
		return "", errors.New("endpoint address is too long")
	}
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Host == "" {
		return "", errors.New("endpoint address must be a URL such as https://api.example.com/v1")
	}
	switch parsed.Scheme {
	case "https":
	case "http":
		if !allowPrivate {
			return "", errors.New("endpoint address must use https")
		}
	default:
		return "", errors.New("endpoint address must start with https://")
	}
	if parsed.User != nil {
		return "", errors.New("endpoint address must not contain credentials; enter the key separately")
	}
	if parsed.RawQuery != "" || parsed.Fragment != "" {
		return "", errors.New("endpoint address must not contain a query string")
	}
	// Refuse obviously internal targets up front for a clear message; the
	// dialer enforces the same rule on the resolved address.
	if !allowPrivate {
		host := parsed.Hostname()
		if ip := net.ParseIP(host); ip != nil && !IsPublicAddress(ip) {
			return "", ErrPrivateEndpoint
		}
		if lower := strings.ToLower(host); lower == "localhost" || strings.HasSuffix(lower, ".localhost") ||
			strings.HasSuffix(lower, ".local") || strings.HasSuffix(lower, ".internal") {
			return "", ErrPrivateEndpoint
		}
	}
	return strings.TrimRight(parsed.String(), "/"), nil
}
