package proxmox

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"
)

const pastedExport = `[
  {"id":"node/pve01","type":"node","node":"pve01","status":"online","maxcpu":12,"maxmem":33539072000,"maxdisk":63000000000,"uptime":86400},
  {"id":"qemu/101","type":"qemu","vmid":101,"name":"docker-prod","node":"pve01","status":"running","maxcpu":4,"maxmem":8589934592,"maxdisk":68719476736,"template":0},
  {"id":"lxc/103","type":"lxc","vmid":"103","name":"homeassistant","node":"pve01","status":"stopped","maxcpu":2,"maxmem":4294967296,"maxdisk":34359738368},
  {"id":"storage/pve01/local-lvm","type":"storage","storage":"local-lvm","node":"pve01","status":"available","maxdisk":236223201280,"disk":1,"plugintype":"lvmthin","shared":0},
  {"id":"sdn/pve01/localnetwork","type":"sdn","node":"pve01","sdn":"localnetwork","status":"ok"}
]`

func TestParseExport(t *testing.T) {
	now := time.Date(2026, 10, 7, 12, 0, 0, 0, time.UTC)
	snapshot, err := ParseExport([]byte(pastedExport), now)
	if err != nil {
		t.Fatalf("ParseExport: %v", err)
	}
	if snapshot.Source != SourcePaste || !snapshot.FetchedAt.Equal(now) {
		t.Fatalf("header: %+v", snapshot)
	}
	node, ok := snapshot.Node("pve01")
	if !ok || !node.Online || node.Threads != 12 || node.MemoryMB != 31985 {
		t.Fatalf("host: %+v", node)
	}
	if len(snapshot.Guests) != 2 || len(snapshot.Storage) != 1 {
		t.Fatalf("guests and storage: %+v", snapshot)
	}
	// A vmid written as a string is still a number.
	container, ok := snapshot.Guest(103)
	if !ok || container.Kind != GuestLXC || container.Status != StatusStopped || container.MemoryMB != 4096 {
		t.Fatalf("container: %+v", container)
	}
	if len(snapshot.Notes) == 0 {
		t.Fatal("an export says what it cannot know")
	}

	// The same list inside the API's envelope.
	wrapped, err := ParseExport([]byte(`{"data":`+pastedExport+`}`), now)
	if err != nil || len(wrapped.Guests) != 2 {
		t.Fatalf("an API envelope: %+v, %v", wrapped, err)
	}
}

func TestParseExportRefusesOtherText(t *testing.T) {
	for name, text := range map[string]string{
		"nothing":            "   ",
		"not json":           "pve01 online 12 cpus",
		"another json":       `{"hello":"world"}`,
		"a list of no hosts": `[{"type":"pool","pool":"prod"}]`,
		"too large":          "[" + strings.Repeat(" ", MaxExportBytes) + "]",
	} {
		if _, err := ParseExport([]byte(text), time.Now()); err == nil {
			t.Errorf("%s: accepted", name)
		}
	}
	if _, err := ParseExport([]byte("{}"), time.Now()); !errors.Is(err, ErrNotAnExport) {
		t.Errorf("an empty object: %v", err)
	}
}

func TestGuestsWithoutAVisibleHostStillHaveAPlace(t *testing.T) {
	// A token with VM.Audit only: guests are listed, hosts are not.
	snapshot, err := ParseExport([]byte(`[{"type":"qemu","vmid":101,"name":"web","node":"pve07","status":"running","maxcpu":2,"maxmem":2147483648}]`), time.Now())
	if err != nil {
		t.Fatalf("ParseExport: %v", err)
	}
	if node, ok := snapshot.Node("pve07"); !ok || !node.Online {
		t.Fatalf("the guest's host is named: %+v", snapshot.Nodes)
	}
}

func TestNamesFromARemoteSystemAreCleaned(t *testing.T) {
	raw := `[{"type":"node","node":"pve01","status":"online"},
		{"type":"qemu","vmid":1,"name":"evil\u0000\u001b[31mname` + strings.Repeat("x", 300) + `","node":"pve01","status":"running"},
		{"type":"lxc","vmid":2,"name":"","node":"pve01","status":"running"}]`
	snapshot, err := ParseExport([]byte(raw), time.Now())
	if err != nil {
		t.Fatalf("ParseExport: %v", err)
	}
	evil, _ := snapshot.Guest(1)
	if strings.ContainsAny(evil.Name, "\x00\x1b") || len([]rune(evil.Name)) > 120 {
		t.Fatalf("control characters and length are taken out: %q", evil.Name)
	}
	if unnamed, _ := snapshot.Guest(2); unnamed.Name != "lxc-2" {
		t.Fatalf("a guest without a name gets one: %q", unnamed.Name)
	}
	if _, err := json.Marshal(snapshot); err != nil {
		t.Fatalf("a snapshot is storable: %v", err)
	}
}

func TestParseNIC(t *testing.T) {
	vm := parseNIC("virtio=BC:24:11:AA:BB:CC,bridge=vmbr0,tag=20,firewall=1")
	if vm.MAC != "BC:24:11:AA:BB:CC" || vm.Bridge != "vmbr0" || vm.VLAN != 20 || vm.IP != "" {
		t.Fatalf("a virtual machine's card: %+v", vm)
	}
	container := parseNIC("name=eth0,bridge=vmbr1,hwaddr=bc:24:11:11:22:33,ip=192.168.20.15/24,gw=192.168.20.1,type=veth")
	if container.MAC != "BC:24:11:11:22:33" || container.Bridge != "vmbr1" || container.IP != "192.168.20.15" {
		t.Fatalf("a container's card: %+v", container)
	}
	if dhcp := parseNIC("name=eth0,bridge=vmbr0,ip=dhcp"); dhcp.IP != "" {
		t.Fatalf("dhcp is no address: %+v", dhcp)
	}
	if got := parseIPConfig("ip=192.168.1.50/24,gw=192.168.1.1"); got != "192.168.1.50" {
		t.Fatalf("cloud-init address: %q", got)
	}
	if got := parseIPConfig("ip=dhcp"); got != "" {
		t.Fatalf("cloud-init dhcp: %q", got)
	}
}

func TestFlexNumber(t *testing.T) {
	var values struct {
		A flexNumber `json:"a"`
		B flexNumber `json:"b"`
		C flexNumber `json:"c"`
		D flexNumber `json:"d"`
		E flexNumber `json:"e"`
	}
	if err := json.Unmarshal([]byte(`{"a":8192,"b":"4096","c":true,"d":null,"e":"many"}`), &values); err != nil {
		t.Fatalf("Unmarshal: %v", err)
	}
	if values.A != 8192 || values.B != 4096 || !values.C.asBool() || values.D != 0 || values.E != 0 {
		t.Fatalf("values: %+v", values)
	}
}

func TestOSName(t *testing.T) {
	for ostype, want := range map[string]string{"l26": "Linux", "win11": "Windows 11", "debian": "Debian", "other": "", "haiku": "haiku"} {
		if got := osName(ostype); got != want {
			t.Errorf("osName(%q) = %q, want %q", ostype, got, want)
		}
	}
}

func TestNormalizeName(t *testing.T) {
	for _, group := range [][]string{
		{"Pi-hole", "pihole", "PiHole", "pi_hole"},
		{"Home Assistant", "homeassistant", "home-assistant"},
	} {
		for _, name := range group[1:] {
			if NormalizeName(name) != NormalizeName(group[0]) {
				t.Errorf("%q and %q are the same guest", name, group[0])
			}
		}
	}
	if NormalizeName("docker-prod") == NormalizeName("docker-test") {
		t.Error("different guests stay different")
	}
}
