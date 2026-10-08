package netguard

import (
	"errors"
	"net"
	"testing"
)

func TestIsPublicAddress(t *testing.T) {
	for _, address := range []string{
		"127.0.0.1", "127.8.9.1", "::1", // loopback
		"10.0.0.5", "172.16.0.1", "172.31.255.255", "192.168.1.50", // private
		"169.254.169.254", "fe80::1", // link-local, incl. cloud metadata
		"100.64.0.1", "100.127.255.254", // carrier-grade NAT
		"fc00::1", "fd12:3456::1", // unique local
		"0.0.0.0", "::", "224.0.0.1", "ff02::1", "255.255.255.255", "240.0.0.1",
		"::ffff:127.0.0.1", "::ffff:10.0.0.1", "::ffff:169.254.169.254", // IPv4-mapped forms
		"64:ff9b::7f00:1", "198.18.0.1", "192.0.0.8",
	} {
		if IsPublicAddress(net.ParseIP(address)) {
			t.Errorf("%s must not be treated as public", address)
		}
	}
	for _, address := range []string{"1.1.1.1", "8.8.8.8", "172.32.0.1", "100.63.255.255", "2606:4700:4700::1111"} {
		if !IsPublicAddress(net.ParseIP(address)) {
			t.Errorf("%s should be public", address)
		}
	}
	if IsPublicAddress(nil) {
		t.Error("an unparsable address must not be treated as public")
	}
}

func TestDialControl(t *testing.T) {
	shared := DialControl(false)
	if err := shared("tcp", "192.168.10.10:8006", nil); !errors.Is(err, ErrPrivateEndpoint) {
		t.Errorf("a private address on a shared instance: %v", err)
	}
	if err := shared("tcp", "[fd00::10]:8006", nil); !errors.Is(err, ErrPrivateEndpoint) {
		t.Errorf("a unique-local address on a shared instance: %v", err)
	}
	if err := shared("tcp", "1.1.1.1:443", nil); err != nil {
		t.Errorf("a public address: %v", err)
	}
	if err := shared("tcp", "no-port", nil); err == nil {
		t.Error("an address that cannot be read must be refused")
	}
	if err := DialControl(true)("tcp", "192.168.10.10:8006", nil); err != nil {
		t.Errorf("a private address on a self-hosted instance: %v", err)
	}
}

func TestIsBlockedHost(t *testing.T) {
	for _, host := range []string{"localhost", "LOCALHOST", "db.localhost", "nas.local", "metadata.internal", "pve.local.", "127.0.0.1", "10.0.0.8", "::1"} {
		if !IsBlockedHost(host) {
			t.Errorf("%s points inside a network", host)
		}
	}
	for _, host := range []string{"pve.example.com", "localhost.example.com", "internal.example.org", "1.1.1.1"} {
		if IsBlockedHost(host) {
			t.Errorf("%s is an ordinary host", host)
		}
	}
}
