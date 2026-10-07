package llm

import (
	"errors"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/Butterski/homelab-builder/backend/internal/netguard"
)

// A user chooses the endpoint the server calls for them. On a shared instance
// that must never become a way to reach the server's own network. The rules
// live in netguard, which the other outbound integrations share; this file is
// what provider calls use.

// ErrPrivateEndpoint means an endpoint resolved to an address the instance may not call.
var ErrPrivateEndpoint = netguard.ErrPrivateEndpoint

// IsPublicAddress reports whether ip is a routable public address: not
// loopback, private, link-local (which includes cloud metadata at
// 169.254.169.254), unique-local, multicast or otherwise reserved.
func IsPublicAddress(ip net.IP) bool {
	return netguard.IsPublicAddress(ip)
}

// SafeHTTPClient returns the HTTP client used for provider calls. Unless
// allowPrivate is set, it refuses to connect to any non-public address. It
// ignores proxy environment variables so the check always sees the real target.
func SafeHTTPClient(allowPrivate bool) *http.Client {
	dialer := &net.Dialer{
		Timeout:   15 * time.Second,
		KeepAlive: 30 * time.Second,
		Control:   netguard.DialControl(allowPrivate),
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
		if netguard.IsInternalHostname(host) {
			return "", ErrPrivateEndpoint
		}
	}
	return strings.TrimRight(parsed.String(), "/"), nil
}
