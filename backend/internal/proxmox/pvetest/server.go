// Package pvetest is a stand-in for the read side of a Proxmox VE API. Go
// tests run the real client against it; cmd/fakepve serves it, so the import
// can be tried in a browser without a cluster.
//
// It is a development tool. It answers only GET, with fixed data.
package pvetest

import (
	"fmt"
	"net/http"
	"sort"
	"strings"
	"sync"
)

const (
	// TokenID and Secret are the only credentials the server accepts.
	TokenID = "hlbuilder@pve!hlbuilder"
	Secret  = "3f1c5d5e-0000-4000-8000-1234567890ab"

	apiPrefix = "/api2/json"
)

// Server answers like a Proxmox VE API and remembers what it was asked.
type Server struct {
	mu       sync.Mutex
	answers  map[string]string
	methods  map[string]int
	paths    []string
	forbid   map[string]bool
	override map[string]string
}

// New is a small cluster: one host online with a virtual machine, a container
// and a template; one host offline.
func New() *Server {
	return newServer(map[string]string{
		"/version": `{"data":{"version":"8.2.4","release":"8.2","repoid":"faa83925"}}`,
		"/cluster/status": `{"data":[
			{"type":"cluster","name":"homelab","nodes":2,"quorate":1},
			{"type":"node","name":"pve01","ip":"192.168.10.10","online":1,"local":1},
			{"type":"node","name":"pve02","ip":"192.168.10.11","online":0}]}`,
		"/cluster/resources": `{"data":[
			{"type":"node","node":"pve01","status":"online","maxcpu":12,"maxmem":33539072000,"mem":9000000000,"maxdisk":63000000000,"uptime":86400},
			{"type":"node","node":"pve02","status":"offline","maxcpu":6,"maxmem":16000000000},
			{"type":"qemu","vmid":101,"name":"docker-prod","node":"pve01","status":"running","maxcpu":4,"maxmem":8589934592,"maxdisk":68719476736,"template":0,"tags":"prod;docker"},
			{"type":"lxc","vmid":103,"name":"homeassistant","node":"pve01","status":"running","maxcpu":2,"maxmem":4294967296,"maxdisk":34359738368},
			{"type":"qemu","vmid":900,"name":"debian-template","node":"pve01","status":"stopped","maxcpu":1,"maxmem":1073741824,"maxdisk":4294967296,"template":1},
			{"type":"lxc","vmid":201,"name":"backup","node":"pve02","status":"stopped","maxcpu":1,"maxmem":536870912,"maxdisk":8589934592},
			{"type":"storage","storage":"local-lvm","node":"pve01","status":"available","maxdisk":236223201280,"disk":90000000000,"plugintype":"lvmthin","shared":0,"content":"images,rootdir"},
			{"type":"storage","storage":"nas","node":"pve01","status":"available","maxdisk":8796093022208,"disk":1000000000000,"plugintype":"nfs","shared":1}]}`,
		"/nodes/pve01/status": `{"data":{
			"cpuinfo":{"model":"AMD Ryzen 5 PRO 4650GE with Radeon Graphics","cores":6,"cpus":12,"sockets":1},
			"memory":{"total":33539072000,"used":9000000000},
			"rootfs":{"total":63000000000},
			"pveversion":"pve-manager/8.2.4/faa83925c9641325","kversion":"Linux 6.8.8-2-pve","uptime":86400}}`,
		"/nodes/pve01/network": `{"data":[
			{"iface":"eno1","type":"eth","active":1},
			{"iface":"vmbr0","type":"bridge","active":1,"address":"192.168.10.10","cidr":"192.168.10.10/24","gateway":"192.168.10.1","bridge_ports":"eno1"}]}`,
		"/nodes/pve01/qemu/101/config": `{"data":{"name":"docker-prod","cores":4,"memory":"8192","ostype":"l26","agent":"1",
			"net0":"virtio=BC:24:11:AA:BB:CC,bridge=vmbr0,tag=20,firewall=1","ipconfig0":"ip=192.168.10.50/24,gw=192.168.10.1"}}`,
		"/nodes/pve01/lxc/103/config": `{"data":{"hostname":"homeassistant","cores":2,"memory":4096,"ostype":"debian",
			"net0":"name=eth0,bridge=vmbr0,hwaddr=BC:24:11:11:22:33,ip=dhcp,type=veth"}}`,
		"/nodes/pve01/lxc/103/interfaces": `{"data":[
			{"name":"lo","hwaddr":"00:00:00:00:00:00","inet":"127.0.0.1/8"},
			{"name":"eth0","hwaddr":"bc:24:11:11:22:33","inet":"192.168.10.63/24"}]}`,
	})
}

func newServer(answers map[string]string) *Server {
	return &Server{answers: answers, methods: map[string]int{}, forbid: map[string]bool{}, override: map[string]string{}}
}

// Deny makes a path answer 403, as it does for a token without the permission.
func (s *Server) Deny(path string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.forbid[path] = true
}

// Allow takes a Deny back.
func (s *Server) Allow(path string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.forbid, path)
}

// Answer replaces what a path answers.
func (s *Server) Answer(path, body string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.override[path] = body
}

// Requests reports what was asked: how often each method, and every path in
// the order of arrival.
func (s *Server) Requests() (methods map[string]int, paths []string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	methods = map[string]int{}
	for method, count := range s.methods {
		methods[method] = count
	}
	return methods, append([]string(nil), s.paths...)
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	path := strings.TrimPrefix(r.URL.Path, apiPrefix)
	s.mu.Lock()
	s.methods[r.Method]++
	s.paths = append(s.paths, r.URL.Path)
	forbidden, override := s.forbid[path], s.override[path]
	answer, known := s.answers[path]
	s.mu.Unlock()

	w.Header().Set("Content-Type", "application/json")
	if r.Method != http.MethodGet {
		http.Error(w, `{"data":null}`, http.StatusMethodNotAllowed)
		return
	}
	if r.Header.Get("Authorization") != "PVEAPIToken="+TokenID+"="+Secret {
		http.Error(w, `{"data":null}`, http.StatusUnauthorized)
		return
	}
	switch {
	case forbidden:
		http.Error(w, `{"data":null}`, http.StatusForbidden)
	case override != "":
		_, _ = w.Write([]byte(override))
	case known:
		_, _ = w.Write([]byte(answer))
	default:
		http.Error(w, `{"data":null}`, http.StatusNotFound)
	}
}

// demoGuest is a guest of the demo cluster.
type demoGuest struct {
	id      int
	name    string
	lxc     bool
	node    string
	cores   int
	memory  int // MB
	disk    int // GB
	running bool
	last    int // last octet of its address; 0 takes DHCP without a lease
	os      string
}

type demoNode struct {
	name    string
	address string
	model   string
	cores   int
	threads int
	memory  int64 // bytes
	local   int   // GB of local-lvm
}

// Demo is a cluster like the one a small homelab runs: three hosts, eleven
// virtual machines and seven containers, a few of them stopped.
func Demo() *Server {
	nodes := []demoNode{
		// The thin pool Proxmox makes on a 240 GB disk and on a 1 TB one: with the
		// root volume a host shows somewhat less than the size printed on the disk.
		{"pve01", "192.168.10.11", "AMD Ryzen 5 PRO 4650GE with Radeon Graphics", 6, 12, 33_539_072_000, 141},
		{"pve02", "192.168.10.12", "Intel(R) Core(TM) i5-9500T CPU @ 2.20GHz", 6, 6, 33_403_928_576, 794},
		{"pve03", "192.168.10.13", "Intel(R) Core(TM) i5-9500T CPU @ 2.20GHz", 6, 6, 16_655_335_424, 141},
	}
	guests := []demoGuest{
		{100, "homeassistant", true, "pve01", 2, 4096, 32, true, 15, "debian"},
		{101, "docker-prod", false, "pve01", 4, 8192, 64, true, 50, "l26"},
		{102, "pihole", true, "pve01", 1, 512, 8, true, 53, "debian"},
		{103, "grafana", true, "pve01", 2, 2048, 16, true, 60, "debian"},
		{104, "vaultwarden", true, "pve01", 1, 1024, 8, true, 61, "alpine"},
		{105, "opnsense-lab", false, "pve01", 2, 2048, 16, false, 0, "other"},
		{110, "truenas", false, "pve02", 4, 16384, 32, true, 20, "other"},
		{111, "jellyfin", false, "pve02", 4, 8192, 64, true, 21, "l26"},
		{112, "nextcloud", false, "pve02", 2, 4096, 100, true, 22, "l26"},
		{113, "paperless", true, "pve02", 2, 2048, 24, true, 23, "debian"},
		{114, "windows-11", false, "pve02", 4, 8192, 120, false, 0, "win11"},
		{115, "ubuntu-temp", false, "pve02", 2, 2048, 32, false, 0, "l26"},
		{120, "k3s-server", false, "pve03", 2, 4096, 40, true, 30, "l26"},
		{121, "k3s-agent-1", false, "pve03", 2, 4096, 40, true, 31, "l26"},
		{122, "k3s-agent-2", false, "pve03", 2, 4096, 40, true, 32, "l26"},
		{123, "uptime-kuma", true, "pve03", 1, 512, 8, true, 40, "alpine"},
		{124, "nginx-proxy", true, "pve03", 1, 512, 8, true, 41, "debian"},
		{125, "test-vm", false, "pve03", 1, 1024, 16, false, 0, "l26"},
	}

	answers := map[string]string{
		"/version": `{"data":{"version":"8.4.1","release":"8.4","repoid":"2a5fa54a8503f96d"}}`,
	}
	status := []string{`{"type":"cluster","name":"homelab","nodes":3,"quorate":1}`}
	resources := []string{}
	for _, node := range nodes {
		status = append(status, fmt.Sprintf(`{"type":"node","name":%q,"ip":%q,"online":1}`, node.name, node.address))
		resources = append(resources,
			fmt.Sprintf(`{"type":"node","node":%q,"status":"online","maxcpu":%d,"maxmem":%d,"mem":%d,"maxdisk":63000000000,"uptime":1296000}`,
				node.name, node.threads, node.memory, node.memory/2),
			fmt.Sprintf(`{"type":"storage","storage":"local","node":%q,"status":"available","maxdisk":63000000000,"disk":9000000000,"plugintype":"dir","shared":0,"content":"iso,vztmpl,backup"}`, node.name),
			fmt.Sprintf(`{"type":"storage","storage":"local-lvm","node":%q,"status":"available","maxdisk":%d,"disk":%d,"plugintype":"lvmthin","shared":0,"content":"images,rootdir"}`,
				node.name, int64(node.local)<<30, int64(node.local)<<29),
			fmt.Sprintf(`{"type":"storage","storage":"nas","node":%q,"status":"available","maxdisk":8796093022208,"disk":2199023255552,"plugintype":"nfs","shared":1,"content":"backup,images"}`, node.name),
		)
		answers["/nodes/"+node.name+"/status"] = fmt.Sprintf(`{"data":{
			"cpuinfo":{"model":%q,"cores":%d,"cpus":%d,"sockets":1},
			"memory":{"total":%d,"used":%d},"rootfs":{"total":63000000000},
			"pveversion":"pve-manager/8.4.1/2a5fa54a8503f96d","kversion":"Linux 6.8.12-10-pve","uptime":1296000}}`,
			node.model, node.cores, node.threads, node.memory, node.memory/2)
		answers["/nodes/"+node.name+"/network"] = fmt.Sprintf(`{"data":[
			{"iface":"eno1","type":"eth","active":1},
			{"iface":"vmbr0","type":"bridge","active":1,"address":%q,"cidr":"%s/24","gateway":"192.168.10.1","bridge_ports":"eno1"}]}`,
			node.address, node.address)
	}
	for _, guest := range guests {
		kind, state := "qemu", "stopped"
		if guest.lxc {
			kind = "lxc"
		}
		if guest.running {
			state = "running"
		}
		resources = append(resources, fmt.Sprintf(
			`{"type":%q,"vmid":%d,"name":%q,"node":%q,"status":%q,"maxcpu":%d,"maxmem":%d,"maxdisk":%d,"template":0}`,
			kind, guest.id, guest.name, guest.node, state, guest.cores, int64(guest.memory)<<20, int64(guest.disk)<<30))
		mac := fmt.Sprintf("BC:24:11:00:%02X:%02X", guest.id/100, guest.id%100)
		address := "dhcp"
		if guest.last > 0 {
			address = fmt.Sprintf("192.168.10.%d/24", guest.last)
		}
		path := fmt.Sprintf("/nodes/%s/%s/%d/config", guest.node, kind, guest.id)
		if guest.lxc {
			answers[path] = fmt.Sprintf(`{"data":{"hostname":%q,"cores":%d,"memory":%d,"ostype":%q,"net0":"name=eth0,bridge=vmbr0,hwaddr=%s,ip=%s,type=veth"}}`,
				guest.name, guest.cores, guest.memory, guest.os, mac, address)
			continue
		}
		config := fmt.Sprintf(`{"data":{"name":%q,"cores":%d,"memory":"%d","ostype":%q,"net0":"virtio=%s,bridge=vmbr0"`,
			guest.name, guest.cores, guest.memory, guest.os, mac)
		if guest.last > 0 {
			config += fmt.Sprintf(`,"ipconfig0":"ip=%s,gw=192.168.10.1"`, address)
		}
		answers[path] = config + "}}"
	}
	sort.Strings(resources)
	answers["/cluster/status"] = `{"data":[` + strings.Join(status, ",") + `]}`
	answers["/cluster/resources"] = `{"data":[` + strings.Join(resources, ",") + `]}`
	return newServer(answers)
}
