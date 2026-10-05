package llm

import (
	"errors"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestIsPublicAddress(t *testing.T) {
	blocked := []string{
		"127.0.0.1", "127.8.9.1", "::1", // loopback
		"10.0.0.5", "172.16.0.1", "172.31.255.255", "192.168.1.50", // private
		"169.254.169.254", "fe80::1", // link-local, incl. cloud metadata
		"100.64.0.1", "100.127.255.254", // carrier-grade NAT
		"fc00::1", "fd12:3456::1", // unique local
		"0.0.0.0", "::", "224.0.0.1", "ff02::1", "255.255.255.255", "240.0.0.1",
		"::ffff:127.0.0.1", "::ffff:10.0.0.1", "::ffff:169.254.169.254", // IPv4-mapped forms
		"64:ff9b::7f00:1", "198.18.0.1", "192.0.0.8",
	}
	for _, address := range blocked {
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

func TestSafeHTTPClientRefusesInternalTargets(t *testing.T) {
	internal := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte("internal service"))
	}))
	defer internal.Close()

	// On a shared instance the dial itself is refused, whatever the URL says.
	_, err := SafeHTTPClient(false).Get(internal.URL)
	if err == nil || !errors.Is(err, ErrPrivateEndpoint) {
		t.Fatalf("expected ErrPrivateEndpoint, got %v", err)
	}
	// A hostname is checked after resolution, so a name pointing inwards is refused too.
	_, port, _ := net.SplitHostPort(strings.TrimPrefix(internal.URL, "http://"))
	if _, err := SafeHTTPClient(false).Get("http://localhost:" + port); err == nil || !errors.Is(err, ErrPrivateEndpoint) {
		t.Fatalf("hostname resolving to loopback: got %v", err)
	}

	// A self-hosted instance may reach its own network (a local Ollama).
	resp, err := SafeHTTPClient(true).Get(internal.URL)
	if err != nil {
		t.Fatalf("private endpoints allowed: %v", err)
	}
	resp.Body.Close()
}

func TestSafeHTTPClientIgnoresProxyEnvironment(t *testing.T) {
	t.Setenv("HTTP_PROXY", "http://127.0.0.1:1")
	t.Setenv("HTTPS_PROXY", "http://127.0.0.1:1")
	transport := SafeHTTPClient(false).Transport.(*http.Transport)
	if transport.Proxy != nil {
		t.Fatal("provider requests must not go through an environment proxy: the address check would see the proxy, not the target")
	}
}

func TestValidateBaseURL(t *testing.T) {
	public := map[string]string{
		"https://api.example.com/v1":    "https://api.example.com/v1",
		" https://api.example.com/v1/ ": "https://api.example.com/v1",
		"https://openrouter.ai/api/v1":  "https://openrouter.ai/api/v1",
	}
	for input, want := range public {
		got, err := ValidateBaseURL(input, false)
		if err != nil || got != want {
			t.Errorf("ValidateBaseURL(%q) = %q, %v; want %q", input, got, err, want)
		}
	}

	refusedOnShared := []string{
		"", "api.example.com", "ftp://api.example.com", "file:///etc/passwd",
		"http://api.example.com/v1",         // plain http
		"https://user:pass@api.example.com", // credentials in the URL
		"https://api.example.com/v1?key=1", "https://api.example.com/#x",
		"https://127.0.0.1/v1", "https://10.0.0.8:11434/v1", "https://169.254.169.254/",
		"https://[::1]/v1", "https://localhost/v1", "https://db.internal/v1", "https://nas.local/v1",
		"https://" + strings.Repeat("a", 400) + ".com",
	}
	for _, input := range refusedOnShared {
		if got, err := ValidateBaseURL(input, false); err == nil {
			t.Errorf("ValidateBaseURL(%q) accepted as %q on a shared instance", input, got)
		}
	}

	// Self-hosted: LAN addresses and plain http are fine, malformed input is not.
	for _, input := range []string{"http://192.168.1.50:11434/v1", "http://host.docker.internal:11434/v1", "http://localhost:1234/v1"} {
		if _, err := ValidateBaseURL(input, true); err != nil {
			t.Errorf("ValidateBaseURL(%q) on a self-hosted instance: %v", input, err)
		}
	}
	for _, input := range []string{"", "ollama:11434", "https://user:pass@host/v1", "gopher://host"} {
		if _, err := ValidateBaseURL(input, true); err == nil {
			t.Errorf("ValidateBaseURL(%q) must be rejected everywhere", input)
		}
	}
}
