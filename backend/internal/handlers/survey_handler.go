package handlers

// BETA_SURVEY - Remove this entire file after beta ends.

import (
	"net/http"

	"github.com/Butterski/homelab-builder/backend/internal/models"
	"github.com/gin-gonic/gin"
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

func (in surveyInput) applyTo(survey *models.BetaSurvey) { // BETA_SURVEY
	survey.Rating = in.Rating
	survey.WillUseApp = in.WillUseApp
	survey.FeatureWishlist = in.FeatureWishlist
	survey.OpenSourceInterest = in.OpenSourceInterest
	survey.ContributionIntent = in.ContributionIntent
	survey.DiscordHandle = in.DiscordHandle
	survey.HearAboutUs = in.HearAboutUs
	survey.ExperienceLevel = in.ExperienceLevel
	survey.PrimaryUseCase = in.PrimaryUseCase
	survey.IsCompany = in.IsCompany
	survey.CompanyContact = in.CompanyContact
}

// GetSurvey returns the current user's survey response, or 404 if not submitted yet.
func (h *SurveyHandler) GetSurvey(c *gin.Context) { // BETA_SURVEY
	userID, ok := currentUser(c)
	if !ok {
		return
	}

	var survey models.BetaSurvey
	if err := h.db.Where("user_id = ?", userID).First(&survey).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "survey not found"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": survey})
}

// SubmitSurvey creates a new survey response (one per user, enforced by DB unique index).
func (h *SurveyHandler) SubmitSurvey(c *gin.Context) { // BETA_SURVEY
	userID, ok := currentUser(c)
	if !ok {
		return
	}

	var input surveyInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid input"})
		return
	}

	survey := models.BetaSurvey{UserID: userID}
	input.applyTo(&survey)

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
	userID, ok := currentUser(c)
	if !ok {
		return
	}

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

	input.applyTo(&survey)

	if err := h.db.Save(&survey).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update survey"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": survey})
}
