// Package gaming holds everything that makes a build a gaming build: the build
// kinds, the plan a user fills in (uplink, power circuits, event), the registry
// of game server profiles, and the sizing and report maths.
//
// It imports nothing from the rest of the backend, so models, services and the
// assistant can all depend on it, and its logic is testable without a database.
package gaming

import "fmt"

// Kind says what a build is planned for.
type Kind string

const (
	KindHomelab    Kind = "homelab"
	KindLANParty   Kind = "lan_party"
	KindGameServer Kind = "game_server"
)

// Kinds lists every kind in display order.
var Kinds = []Kind{KindHomelab, KindLANParty, KindGameServer}

// ParseKind validates a kind sent by a client.
func ParseKind(value string) (Kind, error) {
	for _, kind := range Kinds {
		if string(kind) == value {
			return kind, nil
		}
	}
	return "", fmt.Errorf("unknown build kind %q: use homelab, lan_party or game_server", value)
}

// IsGaming reports whether builds of this kind get the gaming plan and report.
func (k Kind) IsGaming() bool {
	return k == KindLANParty || k == KindGameServer
}
