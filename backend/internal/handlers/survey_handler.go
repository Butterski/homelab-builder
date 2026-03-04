package handlers

// BETA_SURVEY - Remove this entire file after beta ends.

import (
	"net/http"

	"github.com/Butterski/homelab-builder/backend/internal/models"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

type SurveyHandler struct { // BETA_SURVEY
	db *gorm.DB
}

func NewSurveyHandler(db *gorm.DB) *SurveyHandler { // BETA_SURVEY
	return &SurveyHandler{db: db}
}

type surveyInput struct { // BETA_SURVEY
	Rating             int    `json:"rating"`
	WillUseApp         string `json:"will_use_app"`
	FeatureWishlist    string `json:"feature_wishlist"`
	OpenSourceInterest string `json:"open_source_interest"`
	ContributionIntent string `json:"contribution_intent"`
	DiscordHandle      string `json:"discord_handle"`
	HearAboutUs        string `json:"hear_about_us"`
	ExperienceLevel    string `json:"experience_level"`
	PrimaryUseCase     string `json:"primary_use_case"`
	IsCompany          bool   `json:"is_company"`
	CompanyContact     string `json:"company_contact"`
}

// GetSurvey returns the current user's survey response, or 404 if not submitted yet.
func (h *SurveyHandler) GetSurvey(c *gin.Context) { // BETA_SURVEY
	userID := c.MustGet("user_id").(uuid.UUID)

	var survey models.BetaSurvey
	if err := h.db.Where("user_id = ?", userID).First(&survey).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "survey not found"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": survey})
}

// SubmitSurvey creates a new survey response (one per user, enforced by DB unique index).
func (h *SurveyHandler) SubmitSurvey(c *gin.Context) { // BETA_SURVEY
	userID := c.MustGet("user_id").(uuid.UUID)

	var input surveyInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid input"})
		return
	}

	survey := models.BetaSurvey{
		UserID:             userID,
		Rating:             input.Rating,
		WillUseApp:         input.WillUseApp,
		FeatureWishlist:    input.FeatureWishlist,
		OpenSourceInterest: input.OpenSourceInterest,
		ContributionIntent: input.ContributionIntent,
		DiscordHandle:      input.DiscordHandle,
		HearAboutUs:        input.HearAboutUs,
		ExperienceLevel:    input.ExperienceLevel,
		PrimaryUseCase:     input.PrimaryUseCase,
		IsCompany:          input.IsCompany,
		CompanyContact:     input.CompanyContact,
	}

	// Upsert: create or update on user_id conflict
	if err := h.db.
		Where(models.BetaSurvey{UserID: userID}).
		Assign(survey).
		FirstOrCreate(&survey).Error; err != nil {
		c.JSON(http.StatusConflict, gin.H{"error": "you have already submitted a survey"})
		return
	}

	c.JSON(http.StatusCreated, gin.H{"data": survey})
}

// UpdateSurvey updates the current user's existing survey response.
func (h *SurveyHandler) UpdateSurvey(c *gin.Context) { // BETA_SURVEY
	userID := c.MustGet("user_id").(uuid.UUID)

	var survey models.BetaSurvey
	if err := h.db.Where("user_id = ?", userID).First(&survey).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "no survey found to update"})
		return
	}

	var input surveyInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid input"})
		return
	}

	survey.Rating = input.Rating
	survey.WillUseApp = input.WillUseApp
	survey.FeatureWishlist = input.FeatureWishlist
	survey.OpenSourceInterest = input.OpenSourceInterest
	survey.ContributionIntent = input.ContributionIntent
	survey.DiscordHandle = input.DiscordHandle
	survey.HearAboutUs = input.HearAboutUs
	survey.ExperienceLevel = input.ExperienceLevel
	survey.PrimaryUseCase = input.PrimaryUseCase
	survey.IsCompany = input.IsCompany
	survey.CompanyContact = input.CompanyContact

	if err := h.db.Save(&survey).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update survey"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": survey})
}
