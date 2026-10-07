package proxmox

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"crypto/tls"
	"crypto/x509"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/Butterski/homelab-builder/backend/internal/netguard"
)

const (
	apiPrefix = "/api2/json"

	// One request may take this long; a whole reading of a cluster this long.
	requestTimeout = 12 * time.Second
	fetchBudget    = 40 * time.Second

	maxResponseBytes = 8 * 1024 * 1024
	// Hosts and guests beyond these are listed without their details.
	maxDetailedNodes  = 32
	maxDetailedGuests = 300
	parallelRequests  = 6
)

// Kinds of failure, so the caller can say what to do about each.
const (
	KindInvalid     = "invalid"     // the address or the token is not well formed
	KindBlocked     = "blocked"     // the instance may not call that address
	KindUnreachable = "unreachable" // nothing answered
	KindCertificate = "certificate" // the certificate is not trusted yet
	KindFingerprint = "fingerprint" // the certificate is not the one that was trusted
	KindAuth        = "auth"        // the token was refused
	KindPermission  = "permission"  // the token may not read what is needed
	KindProtocol    = "protocol"    // the answer is not a Proxmox API
)

// Error is a failure to read a cluster, with a message meant for the owner.
type Error struct {
	Kind    string
	Message string
	// Certificate is set with KindCertificate and KindFingerprint: what the
	// server presented, so the owner can check it and choose to trust it.
	Certificate *Certificate
}

func (e *Error) Error() string { return e.Message }

// Certificate describes the certificate a server presented.
type Certificate struct {
	// Fingerprint is the SHA-256 of the certificate, as Proxmox prints it:
	// upper-case pairs joined by colons.
	Fingerprint string    `json:"fingerprint"`
	Subject     string    `json:"subject"`
	Issuer      string    `json:"issuer"`
	NotAfter    time.Time `json:"not_after"`
}

var tokenIDPattern = regexp.MustCompile(`^[A-Za-z0-9._-]+@[A-Za-z0-9._-]+![A-Za-z0-9._-]+$`)

// NormalizeTokenID checks an API token id: user@realm!tokenname.
func NormalizeTokenID(raw string) (string, error) {
	id := strings.TrimSpace(raw)
	if strings.HasPrefix(id, "PVEAPIToken=") {
		id = strings.TrimPrefix(id, "PVEAPIToken=")
	}
	if !tokenIDPattern.MatchString(id) || len(id) > 160 {
		return "", &Error{Kind: KindInvalid, Message: "The token id has the form user@realm!tokenname, for example hlbuilder@pve!hlbuilder."}
	}
	return id, nil
}

// NormalizeSecret checks a token secret. It is never logged or returned.
func NormalizeSecret(raw string) (string, error) {
	secret := strings.TrimSpace(raw)
	if secret == "" || len(secret) > 200 || strings.ContainsAny(secret, " \t\r\n\x00") {
		return "", &Error{Kind: KindInvalid, Message: "The token secret is not valid. It is the value Proxmox shows once when the token is created."}
	}
	return secret, nil
}

// NormalizeBaseURL checks the address of a Proxmox host and returns it as it is
// stored: scheme, host and port. A pasted "/api2/json" or page path is dropped.
// Plain http is accepted only where private addresses are, as for any other
// endpoint a user names.
func NormalizeBaseURL(raw string, allowPrivate bool) (string, error) {
	invalid := func(message string) (string, error) {
		return "", &Error{Kind: KindInvalid, Message: message}
	}
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return invalid("Enter the address of the Proxmox host, for example https://192.168.10.10:8006.")
	}
	if len(raw) > 300 {
		return invalid("The address is too long.")
	}
	if !strings.Contains(raw, "://") {
		raw = "https://" + raw
	}
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Hostname() == "" {
		return invalid("The address must look like https://192.168.10.10:8006.")
	}
	switch parsed.Scheme {
	case "https":
	case "http":
		if !allowPrivate {
			return invalid("The address must use https.")
		}
	default:
		return invalid("The address must start with https://.")
	}
	if parsed.User != nil {
		return invalid("The address must not contain a user name or password.")
	}
	host := parsed.Hostname()
	if !allowPrivate {
		if ip := net.ParseIP(host); ip != nil && !netguard.IsPublicAddress(ip) {
			return "", &Error{Kind: KindBlocked, Message: blockedMessage}
		}
		if netguard.IsInternalHostname(host) {
			return "", &Error{Kind: KindBlocked, Message: blockedMessage}
		}
	}
	return parsed.Scheme + "://" + parsed.Host, nil
}

const blockedMessage = "This instance may not call private addresses, so it cannot reach a Proxmox host on your own network. Run HLBuilder on that network, or paste an export instead."

// FormatFingerprint writes a SHA-256 the way Proxmox shows it.
func FormatFingerprint(sum []byte) string {
	encoded := strings.ToUpper(hex.EncodeToString(sum))
	parts := make([]string, 0, len(encoded)/2)
	for i := 0; i+1 < len(encoded); i += 2 {
		parts = append(parts, encoded[i:i+2])
	}
	return strings.Join(parts, ":")
}

// NormalizeFingerprint accepts a fingerprint with or without colons and
// returns the stored form, or "" when it is not a SHA-256.
func NormalizeFingerprint(raw string) string {
	compact := strings.ToLower(strings.NewReplacer(":", "", " ", "", "-", "").Replace(strings.TrimSpace(raw)))
	sum, err := hex.DecodeString(compact)
	if err != nil || len(sum) != sha256.Size {
		return ""
	}
	return FormatFingerprint(sum)
}

// Options configure a client for one Proxmox host.
type Options struct {
	BaseURL string
	TokenID string
	Secret  string
	// AllowPrivate lets the client connect to private addresses.
	AllowPrivate bool
	// Fingerprint pins the server certificate. With it set, only that exact
	// certificate is accepted, whoever signed it.
	Fingerprint string
}

// Client reads one Proxmox host or cluster.
type Client struct {
	baseURL string
	auth    string
	http    *http.Client

	mu        sync.Mutex
	presented *Certificate
}

// NewClient builds a client. The options must already be normalised.
func NewClient(opts Options) *Client {
	client := &Client{
		baseURL: strings.TrimRight(opts.BaseURL, "/"),
		auth:    "PVEAPIToken=" + opts.TokenID + "=" + opts.Secret,
	}
	host := ""
	if parsed, err := url.Parse(client.baseURL); err == nil {
		host = parsed.Hostname()
	}
	pinned := NormalizeFingerprint(opts.Fingerprint)

	dialer := &net.Dialer{
		Timeout: 8 * time.Second,
		Control: netguard.DialControl(opts.AllowPrivate),
	}
	client.http = &http.Client{
		Timeout: requestTimeout,
		// A redirect could lead to an address that was never checked or trusted.
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
		Transport: &http.Transport{
			// No environment proxy: the address check must see the real target.
			Proxy:                 nil,
			DialContext:           dialer.DialContext,
			TLSHandshakeTimeout:   8 * time.Second,
			ResponseHeaderTimeout: requestTimeout,
			MaxIdleConnsPerHost:   parallelRequests,
			IdleConnTimeout:       30 * time.Second,
			TLSClientConfig: &tls.Config{
				MinVersion: tls.VersionTLS12,
				// Verification is done in VerifyConnection, where the certificate
				// can be compared with a pinned one and reported when it is unknown.
				InsecureSkipVerify: true, //nolint:gosec
				VerifyConnection: func(state tls.ConnectionState) error {
					return client.verify(state, host, pinned)
				},
			},
		},
	}
	return client
}

// verify accepts a connection when the server's certificate is the pinned one
// or, with nothing pinned, when a public authority vouches for it.
func (c *Client) verify(state tls.ConnectionState, host, pinned string) error {
	if len(state.PeerCertificates) == 0 {
		return errors.New("the server presented no certificate")
	}
	leaf := state.PeerCertificates[0]
	sum := sha256.Sum256(leaf.Raw)
	presented := &Certificate{
		Fingerprint: FormatFingerprint(sum[:]),
		Subject:     leaf.Subject.String(),
		Issuer:      leaf.Issuer.String(),
		NotAfter:    leaf.NotAfter,
	}
	c.mu.Lock()
	c.presented = presented
	c.mu.Unlock()

	if pinned != "" {
		if subtle.ConstantTimeCompare([]byte(pinned), []byte(presented.Fingerprint)) == 1 {
			return nil
		}
		return &Error{
			Kind:        KindFingerprint,
			Message:     "The host now presents a different certificate than the one you trusted. If you renewed it, check the new fingerprint and trust it again.",
			Certificate: presented,
		}
	}
	intermediates := x509.NewCertPool()
	for _, certificate := range state.PeerCertificates[1:] {
		intermediates.AddCert(certificate)
	}
	if _, err := leaf.Verify(x509.VerifyOptions{DNSName: host, Intermediates: intermediates}); err != nil {
		return &Error{
			Kind:        KindCertificate,
			Message:     "The host's certificate is not signed by a public authority, which is the default on Proxmox. Compare its fingerprint with the one Proxmox shows, then trust it.",
			Certificate: presented,
		}
	}
	return nil
}

// Presented is the certificate the server showed on the last connection.
func (c *Client) Presented() *Certificate {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.presented
}

// statusError is a reply that was not a success.
type statusError struct {
	status int
	path   string
}

func (e *statusError) Error() string {
	return fmt.Sprintf("%s answered %d", e.path, e.status)
}

func isStatus(err error, statuses ...int) bool {
	var status *statusError
	if !errors.As(err, &status) {
		return false
	}
	for _, candidate := range statuses {
		if status.status == candidate {
			return true
		}
	}
	return false
}

// get reads one endpoint into out. Only GET is ever sent.
func (c *Client) get(ctx context.Context, path string, out any) error {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL+apiPrefix+path, nil)
	if err != nil {
		return &Error{Kind: KindInvalid, Message: "The address is not valid."}
	}
	request.Header.Set("Authorization", c.auth)
	request.Header.Set("Accept", "application/json")

	response, err := c.http.Do(request)
	if err != nil {
		return c.transportError(err)
	}
	defer response.Body.Close()
	body, err := io.ReadAll(io.LimitReader(response.Body, maxResponseBytes+1))
	if err != nil {
		return c.transportError(err)
	}
	if len(body) > maxResponseBytes {
		return &Error{Kind: KindProtocol, Message: "The host sent more data than this app reads in one answer."}
	}
	if response.StatusCode < 200 || response.StatusCode > 299 {
		return &statusError{status: response.StatusCode, path: path}
	}
	var envelope struct {
		Data json.RawMessage `json:"data"`
	}
	if err := json.Unmarshal(body, &envelope); err != nil || envelope.Data == nil {
		return &Error{Kind: KindProtocol, Message: "The address answered, but not like a Proxmox API. Check the address and the port (8006 unless a proxy is in front)."}
	}
	if err := json.Unmarshal(envelope.Data, out); err != nil {
		return &Error{Kind: KindProtocol, Message: "The host answered in a form this app does not understand."}
	}
	return nil
}

// transportError turns a failed connection into something the owner can act on.
func (c *Client) transportError(err error) error {
	var own *Error
	if errors.As(err, &own) {
		return own
	}
	if errors.Is(err, netguard.ErrPrivateEndpoint) {
		return &Error{Kind: KindBlocked, Message: blockedMessage}
	}
	message := "The host did not answer. Check the address and that this server can reach it."
	if parsed, parseErr := url.Parse(c.baseURL); parseErr == nil && parsed.Port() == "" {
		message += " Proxmox listens on port 8006 unless a proxy is in front of it."
	}
	if errors.Is(err, context.DeadlineExceeded) {
		message = "The host took too long to answer."
	}
	return &Error{Kind: KindUnreachable, Message: message}
}

// essential explains why a call the whole reading depends on failed.
func essential(err error) error {
	var own *Error
	if errors.As(err, &own) {
		return own
	}
	switch {
	case isStatus(err, http.StatusUnauthorized):
		return &Error{Kind: KindAuth, Message: "Proxmox refused the token. Check the token id (user@realm!tokenname) and the secret."}
	case isStatus(err, http.StatusForbidden):
		return &Error{Kind: KindPermission, Message: "The token may not read the cluster. Give the user and the token the PVEAuditor role on /."}
	case isStatus(err, http.StatusNotFound):
		return &Error{Kind: KindProtocol, Message: "The address answered, but there is no Proxmox API at it. Check the address and the port."}
	default:
		return &Error{Kind: KindProtocol, Message: "Proxmox answered with an error: " + err.Error() + "."}
	}
}

type apiVersion struct {
	Version string `json:"version"`
	Release string `json:"release"`
}

type clusterEntry struct {
	Type   string     `json:"type"`
	Name   string     `json:"name"`
	IP     string     `json:"ip"`
	Online flexNumber `json:"online"`
}

type nodeStatus struct {
	CPUInfo struct {
		Model   string     `json:"model"`
		Cores   flexNumber `json:"cores"`
		CPUs    flexNumber `json:"cpus"`
		Sockets flexNumber `json:"sockets"`
	} `json:"cpuinfo"`
	Memory struct {
		Total flexNumber `json:"total"`
		Used  flexNumber `json:"used"`
	} `json:"memory"`
	RootFS struct {
		Total flexNumber `json:"total"`
	} `json:"rootfs"`
	PVEVersion string     `json:"pveversion"`
	KVersion   string     `json:"kversion"`
	Uptime     flexNumber `json:"uptime"`
}

type nodeInterface struct {
	Iface       string     `json:"iface"`
	Type        string     `json:"type"`
	Active      flexNumber `json:"active"`
	Address     string     `json:"address"`
	CIDR        string     `json:"cidr"`
	Gateway     string     `json:"gateway"`
	BridgePorts string     `json:"bridge_ports"`
}

type containerInterface struct {
	Name   string `json:"name"`
	HWAddr string `json:"hwaddr"`
	Inet   string `json:"inet"`
}

type agentInterfaces struct {
	Result []struct {
		Name      string `json:"name"`
		Hardware  string `json:"hardware-address"`
		Addresses []struct {
			Address string `json:"ip-address"`
			Type    string `json:"ip-address-type"`
		} `json:"ip-addresses"`
	} `json:"result"`
}

// Version reads the release of the Proxmox host. It is the cheapest call that
// proves the address, the certificate and the token.
func (c *Client) Version(ctx context.Context) (string, error) {
	var version apiVersion
	if err := c.get(ctx, "/version", &version); err != nil {
		return "", essential(err)
	}
	if version.Version == "" {
		return "", &Error{Kind: KindProtocol, Message: "The address answered, but not like a Proxmox API. Check the address and the port (8006 unless a proxy is in front)."}
	}
	return cleanLabel(version.Version, 40), nil
}

// Fetch reads the whole cluster. Everything it cannot read is left out and
// said in the snapshot's notes; only a failure of the first calls is an error.
func (c *Client) Fetch(ctx context.Context) (*Snapshot, error) {
	return c.read(ctx, true)
}

// Overview reads what a cluster holds without asking every host and guest for
// its details: enough to say that a connection works and what is behind it.
func (c *Client) Overview(ctx context.Context) (*Snapshot, error) {
	return c.read(ctx, false)
}

func (c *Client) read(ctx context.Context, details bool) (*Snapshot, error) {
	ctx, cancel := context.WithTimeout(ctx, fetchBudget)
	defer cancel()

	version, err := c.Version(ctx)
	if err != nil {
		return nil, err
	}
	var resources []resource
	if err := c.get(ctx, "/cluster/resources", &resources); err != nil {
		return nil, essential(err)
	}

	snapshot := &Snapshot{Source: SourceAPI, FetchedAt: time.Now().UTC(), Version: version}
	snapshot.applyResources(resources)
	hostsListed := false
	for _, entry := range resources {
		if entry.Type == "node" {
			hostsListed = true
			break
		}
	}

	var notes noteList
	if !hostsListed && len(snapshot.Guests) > 0 {
		notes.add("The token cannot read the hosts themselves (Sys.Audit on /). Guests are listed; processors, memory and interfaces of the hosts are not.")
	}

	var cluster []clusterEntry
	if err := c.get(ctx, "/cluster/status", &cluster); err == nil {
		for _, entry := range cluster {
			switch entry.Type {
			case "cluster":
				snapshot.Cluster = cleanLabel(entry.Name, 63)
			case "node":
				for i := range snapshot.Nodes {
					if snapshot.Nodes[i].Name == entry.Name {
						snapshot.Nodes[i].Address = hostAddress(entry.IP)
						snapshot.Nodes[i].Online = entry.Online.asBool()
					}
				}
			}
		}
	}

	if details {
		c.readNodes(ctx, snapshot, &notes)
		c.readGuests(ctx, snapshot, &notes)
	}

	if ctx.Err() != nil {
		notes.add("The cluster took too long to read in full. Some details are missing; read it again to get them.")
	}
	snapshot.Notes = notes.list()
	snapshot.sort()
	return snapshot, nil
}

// noteList collects notes from parallel readers, each once.
type noteList struct {
	mu    sync.Mutex
	notes []string
	seen  map[string]bool
}

func (n *noteList) add(note string) {
	n.mu.Lock()
	defer n.mu.Unlock()
	if n.seen == nil {
		n.seen = map[string]bool{}
	}
	if !n.seen[note] {
		n.seen[note] = true
		n.notes = append(n.notes, note)
	}
}

func (n *noteList) list() []string {
	n.mu.Lock()
	defer n.mu.Unlock()
	return append([]string(nil), n.notes...)
}

// inParallel runs work for every index, a few at a time.
func inParallel(count int, work func(i int)) {
	slots := make(chan struct{}, parallelRequests)
	var wait sync.WaitGroup
	for i := 0; i < count; i++ {
		wait.Add(1)
		slots <- struct{}{}
		go func(i int) {
			defer wait.Done()
			defer func() { <-slots }()
			work(i)
		}(i)
	}
	wait.Wait()
}

func (c *Client) readNodes(ctx context.Context, snapshot *Snapshot, notes *noteList) {
	count := len(snapshot.Nodes)
	if count > maxDetailedNodes {
		notes.add(fmt.Sprintf("Only the first %d hosts were read in detail.", maxDetailedNodes))
		count = maxDetailedNodes
	}
	inParallel(count, func(i int) {
		node := &snapshot.Nodes[i]
		if !node.Online || ctx.Err() != nil {
			return
		}
		path := "/nodes/" + url.PathEscape(node.Name)

		var status nodeStatus
		switch err := c.get(ctx, path+"/status", &status); {
		case err == nil:
			node.CPUModel = cleanLabel(status.CPUInfo.Model, 120)
			node.Sockets = status.CPUInfo.Sockets.asInt()
			node.Cores = status.CPUInfo.Cores.asInt()
			if threads := status.CPUInfo.CPUs.asInt(); threads > 0 {
				node.Threads = threads
			}
			if memory := bytesToMB(status.Memory.Total); memory > 0 {
				node.MemoryMB = memory
				node.MemoryUsedMB = bytesToMB(status.Memory.Used)
			}
			if disk := bytesToGB(status.RootFS.Total); disk > 0 {
				node.DiskGB = disk
			}
			node.Version = pveVersion(status.PVEVersion)
			node.Kernel = cleanLabel(status.KVersion, 120)
			node.UptimeSeconds = int64(status.Uptime.asInt())
		case isStatus(err, http.StatusForbidden):
			notes.add("The token cannot read host details (Sys.Audit). Give the user and the token the PVEAuditor role on /.")
		default:
			notes.add(fmt.Sprintf("Host %s did not answer with its details.", node.Name))
		}

		var interfaces []nodeInterface
		if err := c.get(ctx, path+"/network", &interfaces); err == nil {
			for _, entry := range interfaces {
				name := cleanLabel(entry.Iface, 40)
				if name == "" {
					continue
				}
				iface := Interface{
					Name: name, Type: cleanLabel(entry.Type, 20), Active: entry.Active.asBool(),
					Address: hostAddress(entry.Address), Gateway: hostAddress(entry.Gateway),
					BridgePorts: cleanLabel(entry.BridgePorts, 120),
				}
				if iface.Address != "" && strings.Contains(entry.CIDR, "/") {
					iface.CIDR = cleanLabel(entry.CIDR, 40)
				}
				node.Interfaces = append(node.Interfaces, iface)
				// The interface with the default route is how the host is reached.
				if iface.Gateway != "" && iface.Address != "" {
					node.Gateway, node.CIDR = iface.Gateway, iface.CIDR
					if node.Address == "" {
						node.Address = iface.Address
					}
				}
			}
		}
	})
}

// pveVersion takes "8.2.4" out of "pve-manager/8.2.4/faa83925c9641325".
func pveVersion(raw string) string {
	parts := strings.Split(raw, "/")
	if len(parts) >= 2 {
		return cleanLabel(parts[1], 40)
	}
	return cleanLabel(raw, 40)
}

func (c *Client) readGuests(ctx context.Context, snapshot *Snapshot, notes *noteList) {
	online := map[string]bool{}
	for _, node := range snapshot.Nodes {
		online[node.Name] = node.Online
	}
	wanted := []int{}
	for i, guest := range snapshot.Guests {
		if guest.Template || !online[guest.Node] {
			continue
		}
		wanted = append(wanted, i)
	}
	if len(wanted) > maxDetailedGuests {
		notes.add(fmt.Sprintf("Only the first %d guests were read in detail; the rest are listed with their size and state.", maxDetailedGuests))
		wanted = wanted[:maxDetailedGuests]
	}
	inParallel(len(wanted), func(n int) {
		if ctx.Err() != nil {
			return
		}
		guest := &snapshot.Guests[wanted[n]]
		kind := "qemu"
		if guest.Kind == GuestLXC {
			kind = "lxc"
		}
		path := fmt.Sprintf("/nodes/%s/%s/%d", url.PathEscape(guest.Node), kind, guest.VMID)

		var config map[string]json.RawMessage
		if err := c.get(ctx, path+"/config", &config); err != nil {
			if isStatus(err, http.StatusForbidden) {
				notes.add("The token cannot read guest configurations (VM.Audit), so their addresses and network cards are missing.")
			}
			return
		}
		text := func(key string) string {
			var value string
			if raw, ok := config[key]; ok {
				if json.Unmarshal(raw, &value) != nil {
					// A number where a string was expected: take it as written.
					value = strings.Trim(string(raw), `"`)
				}
			}
			return value
		}
		guest.OS = osName(text("ostype"))
		for index := 0; index < 8; index++ {
			line := text(fmt.Sprintf("net%d", index))
			if line == "" {
				continue
			}
			nic := parseNIC(line)
			if guest.MAC == "" {
				guest.MAC, guest.Bridge, guest.VLAN = nic.MAC, nic.Bridge, nic.VLAN
			}
			if guest.IP == "" {
				guest.IP = nic.IP
			}
			if guest.IP == "" {
				guest.IP = parseIPConfig(text(fmt.Sprintf("ipconfig%d", index)))
			}
		}
		if guest.IP != "" || guest.Status != StatusRunning {
			return
		}
		// A running guest that takes its address from DHCP: ask what it holds.
		if guest.Kind == GuestLXC {
			var interfaces []containerInterface
			if c.get(ctx, path+"/interfaces", &interfaces) == nil {
				for _, entry := range interfaces {
					if entry.Name == "lo" {
						continue
					}
					if address := hostAddress(entry.Inet); address != "" {
						guest.IP = address
						break
					}
				}
			}
			return
		}
		if agent := text("agent"); agent == "" || strings.HasPrefix(agent, "0") {
			return
		}
		var agent agentInterfaces
		if c.get(ctx, path+"/agent/network-get-interfaces", &agent) != nil {
			return
		}
		for _, entry := range agent.Result {
			if entry.Name == "lo" {
				continue
			}
			for _, address := range entry.Addresses {
				if address.Type != "ipv4" {
					continue
				}
				if ip := hostAddress(address.Address); ip != "" && !strings.HasPrefix(ip, "127.") && !strings.HasPrefix(ip, "169.254.") {
					guest.IP = ip
					return
				}
			}
		}
	})
}
