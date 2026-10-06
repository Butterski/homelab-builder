package gaming

import (
	"strings"
	"testing"
)

func TestInstance_ParseAndNormalize(t *testing.T) {
	// The stored form is plain JSON: numbers arrive as float64.
	stored := map[string]any{"profile": "valheim", "players": float64(8), "exposure": "port_forward", "port_offset": float64(10)}
	instance, found, err := ParseInstance(stored)
	if err != nil || !found {
		t.Fatalf("ParseInstance: %v %v", found, err)
	}
	if instance != (Instance{Profile: "valheim", Players: 8, Exposure: ExposurePortForward, PortOffset: 10}) {
		t.Fatalf("instance = %+v", instance)
	}
	if _, found, _ := ParseInstance(nil); found {
		t.Error("a guest without game settings is not a game server")
	}
	if _, found, err := ParseInstance("valheim"); !found || err == nil {
		t.Error("game settings that are not an object must be an error")
	}

	// What is left out is filled in; what is stored can be parsed again.
	filled, profile, err := Instance{Profile: "valheim"}.Normalize()
	if err != nil || filled.Players != profile.DefaultPlayers || filled.Exposure != ExposureLAN {
		t.Fatalf("defaults = %+v %v", filled, err)
	}
	again, _, _ := ParseInstance(filled.Details())
	if again != filled {
		t.Errorf("round trip changed the instance: %+v vs %+v", again, filled)
	}

	for name, bad := range map[string]Instance{
		"unknown profile":   {Profile: "pong"},
		"too many players":  {Profile: "valheim", Players: 5000},
		"negative players":  {Profile: "valheim", Players: -1},
		"unknown exposure":  {Profile: "valheim", Exposure: "public"},
		"negative offset":   {Profile: "valheim", PortOffset: -1},
		"offset past 65535": {Profile: "mumble", PortOffset: 900},
	} {
		if _, _, err := bad.Normalize(); err == nil {
			t.Errorf("%s: expected an error", name)
		}
	}
}

func TestBuildHostCompose(t *testing.T) {
	result := BuildHostCompose("Game host", []ComposeServer{
		{Name: "Valheim", Instance: Instance{Profile: "valheim", Players: 10, Exposure: ExposurePortForward, PortOffset: 10}},
		{Name: "Survival World", Instance: Instance{Profile: "minecraft_java", Players: 20, PortOffset: 1}},
		{Name: "Survival World", Instance: Instance{Profile: "minecraft_java"}},
		{Name: "Zombies", Instance: Instance{Profile: "seven_days_to_die"}},
	})
	compose := result.Compose

	for _, want := range []string{
		"# Game servers on Game host",
		"  valheim:\n    image: ghcr.io/community-valheim-tools/valheim-server:latest\n    container_name: valheim\n    restart: unless-stopped\n",
		// Valheim announces its port: the same number inside and outside, and the variable is set.
		`      - "2466:2466/udp"`,
		`      - "2467:2467/udp"`,
		`      SERVER_PORT: "2466"`,
		// Each server keeps its own password variable and its own data folder.
		`      SERVER_PASS: "${VALHEIM_SERVER_PASS}"`,
		"      - ./valheim/config:/config",
		// Minecraft is moved on the host side only: the container still listens on 25565.
		"  survival-world:\n",
		`      - "25566:25565/tcp"`,
		// 2048 + 20 * 100 MB, rounded up to the next 512 MB.
		`      MEMORY: "4096M"`,
		`      MAX_PLAYERS: "20"`,
		"      - ./survival-world/data:/data",
		// The second server of the same name gets its own key.
		"  survival-world-2:\n",
		`      - "25565:25565/tcp"`,
		"      - ./survival-world-2/data:/data",
		"# Not included, install these by hand:",
		"#   Zombies: No container image is suggested",
	} {
		if !strings.Contains(compose, want) {
			t.Errorf("compose is missing %q\n---\n%s", want, compose)
		}
	}
	if strings.Contains(compose, "SERVER_PORT: \"25566\"") {
		t.Error("Minecraft must not be told a port: its container port stays the default")
	}
	if len(result.Skipped) != 1 {
		t.Errorf("skipped = %v", result.Skipped)
	}
	for _, want := range []string{"VALHEIM_SERVER_NAME=\n", "VALHEIM_WORLD_NAME=\n", "VALHEIM_SERVER_PASS=\n"} {
		if !strings.Contains(result.EnvExample, want) {
			t.Errorf("env example is missing %q:\n%s", want, result.EnvExample)
		}
	}
	// Values the plan already knows are not asked for again.
	if strings.Contains(result.EnvExample, "MAX_PLAYERS") || strings.Contains(result.EnvExample, "MEMORY") {
		t.Errorf("env example asks for values the plan fills in:\n%s", result.EnvExample)
	}
}

func TestBuildHostCompose_NothingToRun(t *testing.T) {
	result := BuildHostCompose("VM host", []ComposeServer{{Name: "Zombies", Instance: Instance{Profile: "seven_days_to_die"}}})
	if !strings.Contains(result.Compose, "services: {}") || !strings.Contains(result.Compose, "#   Zombies:") {
		t.Fatalf("a host with nothing to containerise still gets a valid file:\n%s", result.Compose)
	}
}

func TestBuildHostCompose_EveryProfileRenders(t *testing.T) {
	for _, profile := range Profiles() {
		result := BuildHostCompose("Host", []ComposeServer{{Name: profile.Name, Instance: Instance{Profile: profile.Slug}}})
		if profile.Image == "" {
			if len(result.Skipped) != 1 {
				t.Errorf("%s: expected to be listed as a manual install", profile.Slug)
			}
			continue
		}
		if !strings.Contains(result.Compose, "image: "+profile.Image) {
			t.Errorf("%s: image missing from compose", profile.Slug)
		}
		if strings.Contains(result.Compose, "{players}") || strings.Contains(result.Compose, "{ram_mb}") {
			t.Errorf("%s: an unfilled token is left in the compose file:\n%s", profile.Slug, result.Compose)
		}
		for _, spec := range profile.Ports {
			if !strings.Contains(result.Compose, ":"+itoa(spec.Port)+"/"+spec.Proto) {
				t.Errorf("%s: port %d/%s is not published", profile.Slug, spec.Port, spec.Proto)
			}
		}
	}
}

func itoa(value int) string {
	digits := ""
	for value > 0 {
		digits = string(rune('0'+value%10)) + digits
		value /= 10
	}
	return digits
}
