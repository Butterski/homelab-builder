package services

import (
	"encoding/json"
	"errors"
	"strconv"
	"strings"
	"time"

	"github.com/Butterski/homelab-builder/backend/internal/models"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

// ErrInvalidVersion is returned for a release number that is not MAJOR.MINOR.PATCH.
var ErrInvalidVersion = errors.New("version must be MAJOR.MINOR.PATCH")

// maxNotices is how many notices the dialog is given, newest first.
const maxNotices = 50

// WhatsNewService serves the What's new dialog: which release notes an
// account has seen, and what upgrades of the server changed in its builds.
// The notes themselves are part of the frontend.
type WhatsNewService struct {
	db *gorm.DB
}

func NewWhatsNewService(db *gorm.DB) *WhatsNewService {
	return &WhatsNewService{db: db}
}

// WhatsNew is the state of the dialog for one account.
type WhatsNew struct {
	Seen    string       `json:"seen"` // "" when the account saw no notes yet
	Notices []NoticeView `json:"notices"`
}

// NoticeView is a UserNotice as the dialog shows it.
type NoticeView struct {
	ID      uuid.UUID `json:"id"`
	Kind    string    `json:"kind"`
	Version string    `json:"version"`
	// BuildID is nil when the build was deleted since; BuildName is then the
	// name it had.
	BuildID   *uuid.UUID      `json:"build_id"`
	BuildName string          `json:"build_name"`
	Details   json.RawMessage `json:"details"`
	SeenAt    *time.Time      `json:"seen_at"`
	CreatedAt time.Time       `json:"created_at"`
}

// Get returns the last release the account saw and its newest notices, seen
// ones included.
func (s *WhatsNewService) Get(userID uuid.UUID) (*WhatsNew, error) {
	var user models.User
	if err := s.db.Select("id", "whats_new_seen").First(&user, "id = ?", userID).Error; err != nil {
		return nil, err
	}
	var rows []struct {
		ID          uuid.UUID
		Kind        string
		Version     string
		BuildName   string
		Details     json.RawMessage
		SeenAt      *time.Time
		CreatedAt   time.Time
		LiveBuildID *uuid.UUID
		LiveName    *string
	}
	err := s.db.Raw(`SELECT n.id, n.kind, n.version, n.build_name, n.details, n.seen_at, n.created_at,
			b.id AS live_build_id, b.name AS live_name
		FROM user_notices n
		LEFT JOIN builds b ON b.id = n.build_id AND b.user_id = n.user_id
		WHERE n.user_id = ?
		ORDER BY n.created_at DESC, n.id
		LIMIT ?`, userID, maxNotices).Scan(&rows).Error
	if err != nil {
		return nil, err
	}
	result := &WhatsNew{Seen: user.WhatsNewSeen, Notices: make([]NoticeView, 0, len(rows))}
	for _, row := range rows {
		view := NoticeView{
			ID: row.ID, Kind: row.Kind, Version: row.Version, BuildID: row.LiveBuildID,
			BuildName: row.BuildName, Details: row.Details, SeenAt: row.SeenAt, CreatedAt: row.CreatedAt,
		}
		if row.LiveName != nil {
			view.BuildName = *row.LiveName
		}
		result.Notices = append(result.Notices, view)
	}
	return result, nil
}

// MarkSeen records that the account was shown the notes of a release and
// every notice it has. The seen release never goes back: a tab still running
// an older release cannot undo what a newer one showed.
func (s *WhatsNewService) MarkSeen(userID uuid.UUID, release string) error {
	if _, ok := parseRelease(release); !ok {
		return ErrInvalidVersion
	}
	return s.db.Transaction(func(tx *gorm.DB) error {
		var user models.User
		if err := tx.Select("id", "whats_new_seen").First(&user, "id = ?", userID).Error; err != nil {
			return err
		}
		if releaseAfter(release, user.WhatsNewSeen) {
			if err := tx.Model(&user).UpdateColumn("whats_new_seen", release).Error; err != nil {
				return err
			}
		}
		return tx.Model(&models.UserNotice{}).
			Where("user_id = ? AND seen_at IS NULL", userID).
			Update("seen_at", time.Now()).Error
	})
}

// parseRelease reads MAJOR.MINOR.PATCH, each a plain number.
func parseRelease(release string) ([3]int, bool) {
	var parts [3]int
	fields := strings.Split(release, ".")
	if len(release) > 32 || len(fields) != 3 {
		return parts, false
	}
	for i, field := range fields {
		number, err := strconv.Atoi(field)
		if err != nil || number < 0 || field != strconv.Itoa(number) {
			return parts, false
		}
		parts[i] = number
	}
	return parts, true
}

// releaseAfter reports whether a is a later release than b. Anything that
// can be read is later than "" or a value that cannot.
func releaseAfter(a, b string) bool {
	left, ok := parseRelease(a)
	if !ok {
		return false
	}
	right, ok := parseRelease(b)
	if !ok {
		return true
	}
	for i := range left {
		if left[i] != right[i] {
			return left[i] > right[i]
		}
	}
	return false
}
