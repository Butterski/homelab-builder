package proxmox

import (
	"context"
	"crypto/sha256"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/Butterski/homelab-builder/backend/internal/proxmox/pvetest"
)

const (
	testTokenID = pvetest.TokenID
	testSecret  = pvetest.Secret
)

func newFakePVE(t *testing.T) (*httptest.Server, *pvetest.Server) {
	t.Helper()
	fake := pvetest.New()
	server := httptest.NewTLSServer(fake)
	t.Cleanup(server.Close)
	return server, fake
}

func fingerprintOf(server *httptest.Server) string {
	sum := sha256.Sum256(server.Certificate().Raw)
	return FormatFingerprint(sum[:])
}

func clientFor(server *httptest.Server, change func(*Options)) *Client {
	opts := Options{
		BaseURL: server.URL, TokenID: testTokenID, Secret: testSecret,
		AllowPrivate: true, Fingerprint: fingerprintOf(server),
	}
	if change != nil {
		change(&opts)
	}
	return NewClient(opts)
}

func kindOf(t *testing.T, err error) string {
	t.Helper()
	var own *Error
	if !errors.As(err, &own) {
		t.Fatalf("expected a proxmox.Error, got %v", err)
	}
	return own.Kind
}

func TestFetchReadsACluster(t *testing.T) {
	server, fake := newFakePVE(t)
	snapshot, err := clientFor(server, nil).Fetch(context.Background())
	if err != nil {
		t.Fatalf("Fetch: %v", err)
	}
	if snapshot.Source != SourceAPI || snapshot.Version != "8.2.4" || snapshot.Cluster != "homelab" {
		t.Fatalf("header: %+v", snapshot)
	}
	summary := snapshot.Summarize()
	if summary.Nodes != 2 || summary.NodesOnline != 1 || summary.VMs != 1 || summary.Containers != 2 || summary.Templates != 1 {
		t.Fatalf("summary: %+v", summary)
	}

	pve01, _ := snapshot.Node("pve01")
	if pve01.CPUModel != "AMD Ryzen 5 PRO 4650GE with Radeon Graphics" || pve01.Cores != 6 || pve01.Threads != 12 {
		t.Fatalf("processor of pve01: %+v", pve01)
	}
	if pve01.MemoryMB < 31000 || pve01.MemoryMB > 32768 {
		t.Fatalf("memory of pve01: %d MB", pve01.MemoryMB)
	}
	if pve01.Address != "192.168.10.10" || pve01.Gateway != "192.168.10.1" || pve01.CIDR != "192.168.10.10/24" || pve01.Version != "8.2.4" {
		t.Fatalf("network of pve01: %+v", pve01)
	}
	if len(pve01.Interfaces) != 2 || pve01.Interfaces[1].Name != "vmbr0" || pve01.Interfaces[1].BridgePorts != "eno1" {
		t.Fatalf("interfaces of pve01: %+v", pve01.Interfaces)
	}
	if pve02, _ := snapshot.Node("pve02"); pve02.Online || pve02.CPUModel != "" {
		t.Fatalf("an offline host is listed without details: %+v", pve02)
	}

	vm, _ := snapshot.Guest(101)
	if vm.Kind != GuestVM || vm.CPUs != 4 || vm.MemoryMB != 8192 || vm.DiskGB != 64 || vm.OS != "Linux" {
		t.Fatalf("vm 101: %+v", vm)
	}
	if vm.IP != "192.168.10.50" || vm.MAC != "BC:24:11:AA:BB:CC" || vm.Bridge != "vmbr0" || vm.VLAN != 20 {
		t.Fatalf("network of vm 101: %+v", vm)
	}
	if len(vm.Tags) != 2 {
		t.Fatalf("tags of vm 101: %v", vm.Tags)
	}
	// The container takes its address from DHCP: it is asked what it holds.
	container, _ := snapshot.Guest(103)
	if container.Kind != GuestLXC || container.IP != "192.168.10.63" || container.MAC != "BC:24:11:11:22:33" || container.OS != "Debian" {
		t.Fatalf("container 103: %+v", container)
	}
	if template, _ := snapshot.Guest(900); !template.Template {
		t.Fatal("a template is marked as one")
	}
	if got := snapshot.LocalStorageGB("pve01"); got != 220 {
		t.Fatalf("local storage of pve01 = %v GB; shared storage belongs to no host", got)
	}
	if len(snapshot.GuestsOn("pve01")) != 2 {
		t.Fatalf("guests on pve01 leave the template out: %+v", snapshot.GuestsOn("pve01"))
	}

	methods, paths := fake.Requests()
	if len(methods) != 1 || methods[http.MethodGet] == 0 {
		t.Fatalf("only GET requests may be sent, got %v", methods)
	}
	for _, path := range paths {
		if strings.Contains(path, "pve02/") {
			t.Fatalf("an offline host must not be asked for details: %s", path)
		}
		if strings.Contains(path, "/900/") {
			t.Fatalf("a template must not be asked for details: %s", path)
		}
	}
}

func TestOverviewAsksForNoDetails(t *testing.T) {
	server, fake := newFakePVE(t)
	snapshot, err := clientFor(server, nil).Overview(context.Background())
	if err != nil {
		t.Fatalf("Overview: %v", err)
	}
	if snapshot.Summarize().Nodes != 2 || snapshot.Cluster != "homelab" {
		t.Fatalf("overview: %+v", snapshot.Summarize())
	}
	if _, paths := fake.Requests(); len(paths) != 3 {
		t.Fatalf("an overview is three calls, got %v", paths)
	}
}

func TestAnUnknownCertificateIsReportedNotAccepted(t *testing.T) {
	server, fake := newFakePVE(t)
	client := clientFor(server, func(opts *Options) { opts.Fingerprint = "" })
	_, err := client.Version(context.Background())
	if kind := kindOf(t, err); kind != KindCertificate {
		t.Fatalf("kind = %s, want %s", kind, KindCertificate)
	}
	var own *Error
	errors.As(err, &own)
	if own.Certificate == nil || own.Certificate.Fingerprint != fingerprintOf(server) {
		t.Fatalf("the error carries the certificate to check: %+v", own.Certificate)
	}
	if presented := client.Presented(); presented == nil || presented.Fingerprint != fingerprintOf(server) {
		t.Fatalf("Presented() = %+v", presented)
	}
	// The token must not have been sent to a host that was not trusted.
	if _, paths := fake.Requests(); len(paths) != 0 {
		t.Fatalf("a request reached an untrusted host: %v", paths)
	}
}

func TestADifferentCertificateThanTheTrustedOneIsRefused(t *testing.T) {
	server, _ := newFakePVE(t)
	other := sha256.Sum256([]byte("another certificate"))
	client := clientFor(server, func(opts *Options) { opts.Fingerprint = FormatFingerprint(other[:]) })
	_, err := client.Version(context.Background())
	if kind := kindOf(t, err); kind != KindFingerprint {
		t.Fatalf("kind = %s, want %s", kind, KindFingerprint)
	}
}

func TestARefusedTokenIsAnAuthError(t *testing.T) {
	server, _ := newFakePVE(t)
	client := clientFor(server, func(opts *Options) { opts.Secret = "wrong" })
	_, err := client.Fetch(context.Background())
	if kind := kindOf(t, err); kind != KindAuth {
		t.Fatalf("kind = %s, want %s", kind, KindAuth)
	}
}

func TestPrivateAddressesAreRefusedOnASharedInstance(t *testing.T) {
	server, fake := newFakePVE(t)
	client := clientFor(server, func(opts *Options) { opts.AllowPrivate = false })
	_, err := client.Version(context.Background())
	if kind := kindOf(t, err); kind != KindBlocked {
		t.Fatalf("kind = %s, want %s", kind, KindBlocked)
	}
	if _, paths := fake.Requests(); len(paths) != 0 {
		t.Fatalf("a request reached a private address: %v", paths)
	}
}

func TestWhatTheTokenMayNotReadBecomesANote(t *testing.T) {
	server, fake := newFakePVE(t)
	fake.Deny("/nodes/pve01/status")
	fake.Deny("/nodes/pve01/qemu/101/config")
	snapshot, err := clientFor(server, nil).Fetch(context.Background())
	if err != nil {
		t.Fatalf("Fetch: %v", err)
	}
	notes := strings.Join(snapshot.Notes, "\n")
	if !strings.Contains(notes, "Sys.Audit") || !strings.Contains(notes, "VM.Audit") {
		t.Fatalf("notes say which permission is missing: %q", notes)
	}
	// What resources gave is still there.
	if node, _ := snapshot.Node("pve01"); node.Threads != 12 || node.CPUModel != "" {
		t.Fatalf("pve01 without its status: %+v", node)
	}
	if vm, _ := snapshot.Guest(101); vm.MemoryMB != 8192 || vm.MAC != "" {
		t.Fatalf("vm 101 without its config: %+v", vm)
	}
}

func TestSomethingElseAtTheAddressIsAProtocolError(t *testing.T) {
	server, fake := newFakePVE(t)
	fake.Answer("/version", `<html>router login</html>`)
	_, err := clientFor(server, nil).Version(context.Background())
	if kind := kindOf(t, err); kind != KindProtocol {
		t.Fatalf("kind = %s, want %s", kind, KindProtocol)
	}
	fake.Answer("/version", `{"data":{"unrelated":true}}`)
	_, err = clientFor(server, nil).Version(context.Background())
	if kind := kindOf(t, err); kind != KindProtocol {
		t.Fatalf("an answer without a version: kind = %s", kind)
	}
}

func TestARedirectIsNotFollowed(t *testing.T) {
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Errorf("the redirect target was called with %q", r.Header.Get("Authorization"))
	}))
	defer target.Close()
	redirecting := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, target.URL, http.StatusFound)
	}))
	defer redirecting.Close()
	_, err := clientFor(redirecting, nil).Version(context.Background())
	if kind := kindOf(t, err); kind != KindProtocol {
		t.Fatalf("kind = %s, want %s", kind, KindProtocol)
	}
}

func TestNormalizeBaseURL(t *testing.T) {
	accepted := map[string]string{
		"https://192.168.10.10:8006":                 "https://192.168.10.10:8006",
		" 192.168.10.10:8006 ":                       "https://192.168.10.10:8006",
		"https://pve.example.com:8006/api2/json":     "https://pve.example.com:8006",
		"https://pve.example.com/#v1:0:18:4:::::::":  "https://pve.example.com",
		"http://192.168.10.10:8006":                  "http://192.168.10.10:8006",
		"https://[fd00::10]:8006/":                   "https://[fd00::10]:8006",
		"https://pve.lan:8006/?console=shell&node=x": "https://pve.lan:8006",
	}
	for input, want := range accepted {
		got, err := NormalizeBaseURL(input, true)
		if err != nil || got != want {
			t.Errorf("NormalizeBaseURL(%q) = %q, %v; want %q", input, got, err, want)
		}
	}
	for _, input := range []string{"", "ftp://pve:8006", "https://user:pass@pve:8006", "https://", strings.Repeat("a", 400)} {
		if _, err := NormalizeBaseURL(input, true); err == nil {
			t.Errorf("NormalizeBaseURL(%q) must be refused", input)
		}
	}
	// A shared instance: https only, and nothing that points inside a network.
	for input, kind := range map[string]string{
		"http://pve.example.com:8006": KindInvalid,
		"https://192.168.10.10:8006":  KindBlocked,
		"https://127.0.0.1:8006":      KindBlocked,
		"https://[::1]:8006":          KindBlocked,
		"https://169.254.169.254":     KindBlocked,
		"https://pve.local:8006":      KindBlocked,
		"https://localhost:8006":      KindBlocked,
	} {
		_, err := NormalizeBaseURL(input, false)
		if err == nil || kindOf(t, err) != kind {
			t.Errorf("NormalizeBaseURL(%q) on a shared instance: %v, want kind %s", input, err, kind)
		}
	}
	if got, err := NormalizeBaseURL("https://pve.example.com:8006", false); err != nil || got != "https://pve.example.com:8006" {
		t.Errorf("a public address on a shared instance: %q, %v", got, err)
	}
}

func TestNormalizeTokenAndFingerprint(t *testing.T) {
	for input, want := range map[string]string{
		"hlbuilder@pve!hlbuilder":             "hlbuilder@pve!hlbuilder",
		" PVEAPIToken=root@pam!monitoring ":   "root@pam!monitoring",
		"svc.hlb-1@my-realm.example!tok_en-2": "svc.hlb-1@my-realm.example!tok_en-2",
	} {
		if got, err := NormalizeTokenID(input); err != nil || got != want {
			t.Errorf("NormalizeTokenID(%q) = %q, %v", input, got, err)
		}
	}
	for _, input := range []string{"", "hlbuilder@pve", "hlbuilder!token", "a@b!c=secret", "a b@pve!c"} {
		if _, err := NormalizeTokenID(input); err == nil {
			t.Errorf("NormalizeTokenID(%q) must be refused", input)
		}
	}
	for _, input := range []string{"", "has space", "line\nbreak", strings.Repeat("s", 201)} {
		if _, err := NormalizeSecret(input); err == nil {
			t.Errorf("NormalizeSecret(%q) must be refused", input)
		}
	}

	sum := sha256.Sum256([]byte("certificate"))
	formatted := FormatFingerprint(sum[:])
	if len(formatted) != 95 || strings.Count(formatted, ":") != 31 || formatted != strings.ToUpper(formatted) {
		t.Fatalf("fingerprint format: %q", formatted)
	}
	compact := strings.ToLower(strings.ReplaceAll(formatted, ":", ""))
	if NormalizeFingerprint(compact) != formatted || NormalizeFingerprint(" "+formatted+" ") != formatted {
		t.Fatal("a fingerprint is recognised with or without colons")
	}
	if NormalizeFingerprint("AB:CD") != "" || NormalizeFingerprint("not hex") != "" {
		t.Fatal("anything but a SHA-256 is no fingerprint")
	}
}

func TestTheDemoClusterReadsLikeAHomelab(t *testing.T) {
	server := httptest.NewTLSServer(pvetest.Demo())
	defer server.Close()
	snapshot, err := clientFor(server, nil).Fetch(context.Background())
	if err != nil {
		t.Fatalf("Fetch: %v", err)
	}
	summary := snapshot.Summarize()
	if summary.Cluster != "homelab" || summary.Nodes != 3 || summary.NodesOnline != 3 || summary.VMs != 11 || summary.Containers != 7 {
		t.Fatalf("summary: %+v", summary)
	}
	if len(snapshot.Notes) != 0 {
		t.Fatalf("everything of the demo can be read: %v", snapshot.Notes)
	}
	for _, node := range snapshot.Nodes {
		if node.CPUModel == "" || node.Gateway != "192.168.10.1" || node.MemoryMB == 0 || snapshot.LocalStorageGB(node.Name) == 0 {
			t.Fatalf("host %s: %+v", node.Name, node)
		}
	}
	jellyfin, _ := snapshot.Guest(111)
	if jellyfin.Name != "jellyfin" || jellyfin.Node != "pve02" || jellyfin.IP != "192.168.10.21" || jellyfin.MAC == "" || jellyfin.MemoryMB != 8192 {
		t.Fatalf("guest 111: %+v", jellyfin)
	}
	if stopped, _ := snapshot.Guest(125); stopped.Status != StatusStopped || stopped.IP != "" {
		t.Fatalf("guest 125 is stopped and has no address: %+v", stopped)
	}
}
