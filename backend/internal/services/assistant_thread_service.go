package services

import (
	"encoding/json"
	"errors"

	"github.com/Butterski/homelab-builder/backend/internal/models"
	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// Roles of a stored assistant message.
const (
	AssistantRoleUser      = "user"
	AssistantRoleAssistant = "assistant"
	AssistantRoleTool      = "tool"
)

// Kinds of message part. A message is a list of parts in the order they occurred.
const (
	PartText       = "text"        // visible text
	PartContext    = "context"     // build context sent to the model with a user message; not shown
	PartToolCall   = "tool_call"   // the model asked for a tool
	PartToolResult = "tool_result" // what the tool returned
	PartProposal   = "proposal"    // a proposal the turn created, for the proposal card
	PartNotice     = "notice"      // a note for the user, such as a stopped turn; not sent to the model
)

// MessagePart is the provider-neutral form of a piece of a message. It is what
// the chat panel renders, and what the conversation is rebuilt from when it
// continues with a different provider or model.
type MessagePart struct {
	Type string `json:"type"`
	Text string `json:"text,omitempty"`

	// tool_call and tool_result
	ID    string          `json:"id,omitempty"`
	Name  string          `json:"name,omitempty"`
	Input json.RawMessage `json:"input,omitempty"`
	// Content is the exact text returned to the model for a tool call.
	Content string `json:"content,omitempty"`
	IsError bool   `json:"is_error,omitempty"`

	// proposal
	ProposalID string `json:"proposal_id,omitempty"`
}

// AssistantThreadService stores the one assistant conversation a user has
// about each build.
type AssistantThreadService struct {
	db *gorm.DB
}

func NewAssistantThreadService(db *gorm.DB) *AssistantThreadService {
	return &AssistantThreadService{db: db}
}

// Find returns the user's thread for a build, or nil when none exists yet.
func (s *AssistantThreadService) Find(userID, buildID uuid.UUID) (*models.AssistantThread, error) {
	var thread models.AssistantThread
	err := s.db.First(&thread, "user_id = ? AND build_id = ?", userID, buildID).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &thread, nil
}

// GetOrCreate returns the user's thread for a build. The caller has already
// checked that the user owns the build.
func (s *AssistantThreadService) GetOrCreate(userID, buildID uuid.UUID) (*models.AssistantThread, error) {
	thread := models.AssistantThread{UserID: userID, BuildID: buildID}
	// Two tabs may send a first message at once; the unique index picks one row.
	if err := s.db.Clauses(clause.OnConflict{DoNothing: true}).Create(&thread).Error; err != nil {
		return nil, err
	}
	found, err := s.Find(userID, buildID)
	if err != nil {
		return nil, err
	}
	if found == nil {
		return nil, errors.New("assistant thread could not be created")
	}
	return found, nil
}

// Messages lists a thread's messages in order.
func (s *AssistantThreadService) Messages(threadID uuid.UUID) ([]models.AssistantMessage, error) {
	messages := []models.AssistantMessage{}
	err := s.db.Where("thread_id = ?", threadID).Order("seq asc").Find(&messages).Error
	return messages, err
}

// Append stores the next message of a thread.
func (s *AssistantThreadService) Append(threadID uuid.UUID, role, provider, model string, parts []MessagePart, native json.RawMessage, interrupted bool) (*models.AssistantMessage, error) {
	encoded, err := json.Marshal(parts)
	if err != nil {
		return nil, err
	}
	message := &models.AssistantMessage{
		ThreadID: threadID, Role: role, Provider: provider, Model: model,
		Parts: encoded, Native: native, Interrupted: interrupted,
	}
	err = s.db.Transaction(func(tx *gorm.DB) error {
		// The thread row serialises writers so sequence numbers never collide.
		var thread models.AssistantThread
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&thread, "id = ?", threadID).Error; err != nil {
			return err
		}
		var last int
		if err := tx.Model(&models.AssistantMessage{}).Where("thread_id = ?", threadID).
			Select("COALESCE(MAX(seq), 0)").Scan(&last).Error; err != nil {
			return err
		}
		message.Seq = last + 1
		if err := tx.Create(message).Error; err != nil {
			return err
		}
		return tx.Model(&thread).Update("updated_at", message.CreatedAt).Error
	})
	if err != nil {
		return nil, err
	}
	return message, nil
}

// Clear deletes the user's conversation about a build.
func (s *AssistantThreadService) Clear(userID, buildID uuid.UUID) error {
	return s.db.Transaction(func(tx *gorm.DB) error {
		var thread models.AssistantThread
		err := tx.First(&thread, "user_id = ? AND build_id = ?", userID, buildID).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil
		}
		if err != nil {
			return err
		}
		if err := tx.Where("thread_id = ?", thread.ID).Delete(&models.AssistantMessage{}).Error; err != nil {
			return err
		}
		return tx.Delete(&thread).Error
	})
}

// DecodeParts reads the parts of a stored message.
func DecodeParts(message models.AssistantMessage) []MessagePart {
	parts := []MessagePart{}
	_ = json.Unmarshal(message.Parts, &parts)
	return parts
}
