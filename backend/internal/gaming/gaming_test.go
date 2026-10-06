package gaming

import (
	"encoding/json"
	"fmt"
	"regexp"
	"strings"
	"testing"
)

func TestParseKind(t *testing.T) {
	for _, kind := range Kinds {
		got, err := ParseKind(string(kind))
		if err != nil || got != kind {
			t.Errorf("ParseKind(%q) = %q, %v", kind, got, err)
		}
	}
	if _, err := ParseKind("arcade"); err == nil {
		t.Error("expected an unknown kind to be rejected")
	}
	if KindHomelab.IsGaming() || !KindLANParty.IsGaming() || !KindGameServer.IsGaming() {
		t.Error("only lan_party and game_server are gaming kinds")
	}
}

func TestPlanNormalize(t *testing.T) {
	plan := Plan{
		Uplink: Uplink{DownMbps: 300, UpMbps: 30, CGNAT: "no", PublicHost: "  play.example.org "},
		Power: Power{MainsVoltage: 230, Circuits: []Circuit{
			{ID: "c1", Label: " Kitchen ", BreakerAmps: 16},
			{ID: "c2", BreakerAmps: 10},
		}},
		Event: Event{Date: "2026-11-14", Hours: 36},
	}
	got, err := plan.Normalize()
	if err != nil {
		t.Fatalf("Normalize: %v", err)
	}
	if got.Uplink.PublicHost != "play.example.org" || got.Power.Circuits[0].Label != "Kitchen" {
		t.Errorf("expected trimmed strings, got %+v", got)
	}
	if circuit, ok := got.Circuit("c2"); !ok || circuit.BreakerAmps != 10 {
		t.Errorf("Circuit(c2) = %+v, %v", circuit, ok)
	}

	// Stored and read back, a plan must not change: the builder compares what it
	// loaded with what it would save to decide whether there is anything to save.
	stored, _ := json.Marshal(got)
	parsed, err := ParsePlan(stored)
	if err != nil {
		t.Fatalf("ParsePlan: %v", err)
	}
	again, err := parsed.Normalize()
	if err != nil {
		t.Fatalf("Normalize after round trip: %v", err)
	}
	restored, _ := json.Marshal(again)
	if string(restored) != string(stored) {
		t.Errorf("plan changed on a round trip:\n%s\n%s", stored, restored)
	}
}

func TestPlanNormalize_EmptyPlanHasAnEmptyCircuitList(t *testing.T) {
	got, err := Plan{}.Normalize()
	if err != nil {
		t.Fatalf("Normalize: %v", err)
	}
	raw, _ := json.Marshal(got)
	if !strings.Contains(string(raw), `"circuits":[]`) {
		t.Errorf("expected an empty list, not null: %s", raw)
	}
	parsed, err := ParsePlan(json.RawMessage(`{}`))
	if err != nil || parsed.Power.Circuits == nil {
		t.Errorf("ParsePlan({}) = %+v, %v", parsed, err)
	}
}

func TestPlanNormalize_Rejects(t *testing.T) {
	cases := map[string]Plan{
		"negative speed":       {Uplink: Uplink{UpMbps: -1}},
		"unknown cgnat":        {Uplink: Uplink{CGNAT: "maybe"}},
		"host with a path":     {Uplink: Uplink{PublicHost: "example.org/join"}},
		"host with a space":    {Uplink: Uplink{PublicHost: "my house"}},
		"voltage out of range": {Power: Power{MainsVoltage: 400}},
		"breaker out of range": {Power: Power{Circuits: []Circuit{{ID: "c1", BreakerAmps: 0}}}},
		"duplicate circuit":    {Power: Power{Circuits: []Circuit{{ID: "c1", BreakerAmps: 16}, {ID: "c1", BreakerAmps: 16}}}},
		"circuit id with dot":  {Power: Power{Circuits: []Circuit{{ID: "c.1", BreakerAmps: 16}}}},
		"bad date":             {Event: Event{Date: "14/11/2026"}},
		"negative hours":       {Event: Event{Hours: -2}},
	}
	for name, plan := range cases {
		if _, err := plan.Normalize(); err == nil {
			t.Errorf("%s: expected an error", name)
		}
	}
}

func TestProfiles_RegistryIsConsistent(t *testing.T) {
	slugPattern := regexp.MustCompile(`^[a-z0-9_]+$`)
	idPattern := regexp.MustCompile(`^a1000000-0000-0000-0000-000000000\d{3}$`)
	slugs, ids, names := map[string]bool{}, map[string]bool{}, map[string]bool{}

	for _, profile := range Profiles() {
		if !slugPattern.MatchString(profile.Slug) || slugs[profile.Slug] {
			t.Errorf("%s: slug must be unique snake_case", profile.Slug)
		}
		if !idPattern.MatchString(profile.ServiceID) || ids[profile.ServiceID] {
			t.Errorf("%s: service id %q must be unique and in the seed series", profile.Slug, profile.ServiceID)
		}
		if profile.Name == "" || names[profile.Name] {
			t.Errorf("%s: name must be set and unique", profile.Slug)
		}
		slugs[profile.Slug], ids[profile.ServiceID], names[profile.Name] = true, true, true

		if profile.Role != RoleGame && profile.Role != RoleTool {
			t.Errorf("%s: role %q", profile.Slug, profile.Role)
		}
		if profile.Role == RoleGame && (profile.DefaultPlayers < 1 || profile.MaxPlayers < profile.DefaultPlayers) {
			t.Errorf("%s: a game needs default and maximum player counts", profile.Slug)
		}
		if profile.BaseRAMMB <= 0 || profile.BaseCPUCores <= 0 || profile.StorageGB <= 0 {
			t.Errorf("%s: base sizing must be set", profile.Slug)
		}
		if profile.Description == "" || profile.Website == "" || profile.Docs == "" {
			t.Errorf("%s: description, website and docs must be set", profile.Slug)
		}
		if len(profile.Ports) == 0 {
			t.Errorf("%s: at least one port", profile.Slug)
		}

		seen := map[string]bool{}
		forwarded := false
		for _, spec := range profile.Ports {
			if spec.Port < 1 || spec.Port > 65535 {
				t.Errorf("%s: port %d is out of range", profile.Slug, spec.Port)
			}
			if spec.Proto != "tcp" && spec.Proto != "udp" {
				t.Errorf("%s: port %d has protocol %q", profile.Slug, spec.Port, spec.Proto)
			}
			key := fmt.Sprintf("%d/%s", spec.Port, spec.Proto)
			if seen[key] {
				t.Errorf("%s: port %d/%s is listed twice", profile.Slug, spec.Port, spec.Proto)
			}
			seen[key] = true
			forwarded = forwarded || spec.Forward
		}
		if profile.Role == RoleGame && !forwarded {
			t.Errorf("%s: a game needs at least one port to forward", profile.Slug)
		}

		// A profile without an image must say how to install the server instead.
		if profile.Image == "" && (profile.Notes == "" || len(profile.Env) > 0 || len(profile.Volumes) > 0) {
			t.Errorf("%s: without an image there must be a note and no container settings", profile.Slug)
		}

		if got, ok := ProfileBySlug(profile.Slug); !ok || got.ServiceID != profile.ServiceID {
			t.Errorf("%s: ProfileBySlug mismatch", profile.Slug)
		}
		if got, ok := ProfileByServiceID(profile.ServiceID); !ok || got.Slug != profile.Slug {
			t.Errorf("%s: ProfileByServiceID mismatch", profile.Slug)
		}
	}

	for _, slug := range []string{
		"minecraft_java", "minecraft_bedrock", "valheim", "palworld", "cs2", "terraria", "factorio",
		"satisfactory", "rust", "ark_se", "project_zomboid", "seven_days_to_die", "enshrouded", "v_rising",
		"lancache", "pelican_panel", "crafty_controller", "mumble", "teamspeak",
	} {
		if !slugs[slug] {
			t.Errorf("profile %q is missing", slug)
		}
	}
	if profile, _ := ProfileBySlug("minecraft_java"); profile.ServiceID != "a1000000-0000-0000-0000-000000000011" {
		t.Errorf("Minecraft Java must keep the original catalog id, got %s", profile.ServiceID)
	}
	// Servers that announce their port need a variable for it; plain ones are remapped on the host.
	if valheim, _ := ProfileBySlug("valheim"); !valheim.AnnouncesPorts() {
		t.Error("valheim announces its port")
	}
	if minecraft, _ := ProfileBySlug("minecraft_java"); minecraft.AnnouncesPorts() {
		t.Error("minecraft is moved by remapping the host port")
	}
	if _, ok := ProfileBySlug("pong"); ok {
		t.Error("unknown slug must not resolve")
	}
}

func TestSizeServer(t *testing.T) {
	valheim, _ := ProfileBySlug("valheim")

	ten := SizeServer(valheim, 10)
	// 3072 + 10*150 = 4572 MB -> 4608; 1.5 + 10*0.1 = 2.5 cores; 10 * 150 kbps.
	if ten.RAMMB != 4608 || ten.CPUCores != 2.5 || ten.UploadKbps != 1500 || ten.StorageGB != valheim.StorageGB {
		t.Errorf("valheim for 10 = %+v", ten)
	}

	// No player count means the usual group for that game.
	if usual := SizeServer(valheim, 0); usual != SizeServer(valheim, valheim.DefaultPlayers) {
		t.Errorf("zero players should size for the default group, got %+v", usual)
	}

	// Sizing grows with players and never drops below the floor.
	if more := SizeServer(valheim, 20); more.RAMMB <= ten.RAMMB || more.CPUCores <= ten.CPUCores {
		t.Errorf("expected more players to need more: %+v vs %+v", more, ten)
	}
	tiny := SizeServer(Profile{BaseRAMMB: 64, BaseCPUCores: 0.1}, 1)
	if tiny.RAMMB != 512 || tiny.CPUCores != 0.5 {
		t.Errorf("floor = %+v", tiny)
	}
}

func TestResolvePorts(t *testing.T) {
	valheim, _ := ProfileBySlug("valheim")
	ports := ResolvePorts(valheim, 10)
	if len(ports) != 2 || ports[0].Port != 2466 || ports[0].Base != 2456 || ports[1].Port != 2467 {
		t.Errorf("ResolvePorts = %+v", ports)
	}
	if ports[0].Env != "SERVER_PORT" || ports[0].Proto != "udp" || !ports[0].Forward {
		t.Errorf("port details lost: %+v", ports[0])
	}
}

func TestMaxOffset(t *testing.T) {
	valheim, _ := ProfileBySlug("valheim")
	if valheim.MaxOffset() != MaxPortOffset {
		t.Errorf("valheim offset limit = %d", valheim.MaxOffset())
	}
	// Mumble listens on 64738, so only 797 ports are left above it.
	mumble, _ := ProfileBySlug("mumble")
	if mumble.MaxOffset() != 65535-64738 {
		t.Errorf("mumble offset limit = %d", mumble.MaxOffset())
	}
}

func TestValidExposure(t *testing.T) {
	for _, exposure := range Exposures {
		if !ValidExposure(exposure) {
			t.Errorf("%q should be valid", exposure)
		}
	}
	if ValidExposure("public") {
		t.Error("unknown exposure accepted")
	}
}
