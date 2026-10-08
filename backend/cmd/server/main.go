package main

import (
	"fmt"
	"log"
	"time"

	"github.com/Butterski/homelab-builder/backend/internal/assistant"
	"github.com/Butterski/homelab-builder/backend/internal/config"
	"github.com/Butterski/homelab-builder/backend/internal/handlers"
	"github.com/Butterski/homelab-builder/backend/internal/mcpserver"
	"github.com/Butterski/homelab-builder/backend/internal/middleware"
	"github.com/Butterski/homelab-builder/backend/internal/secrets"
	"github.com/Butterski/homelab-builder/backend/internal/services"
	"github.com/Butterski/homelab-builder/backend/internal/version"
	"github.com/Butterski/homelab-builder/backend/pkg/database"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

func main() {
	log.Println("Starting HLBuilder Backend...")
	cfg := config.Load()

	db, err := connectDatabaseWithRetry(cfg, 10, 3*time.Second)
	if err != nil {
		log.Fatalf("Failed to connect to database after retries: %v", err)
	}

	log.Println("Database connected. Setting up routes...")

	router := setupRouter(cfg, db)
	startServer(router, cfg.ServerPort)
}

func connectDatabaseWithRetry(cfg *config.Config, maxAttempts int, delay time.Duration) (*gorm.DB, error) {
	var lastErr error

	for attempt := 1; attempt <= maxAttempts; attempt++ {
		db, err := database.Connect(cfg)
		if err == nil {
			return db, nil
		}

		lastErr = err
		log.Printf("Database connection attempt %d/%d failed: %v", attempt, maxAttempts, err)

		if attempt < maxAttempts {
			time.Sleep(delay)
		}
	}

	return nil, lastErr
}

func startServer(router *gin.Engine, port string) {
	addr := fmt.Sprintf(":%s", port)
	log.Printf("Starting server on %s", addr)
	if err := router.Run(addr); err != nil {
		log.Fatalf("Failed to start server: %v", err)
	}
}

func setupRouter(cfg *config.Config, db *gorm.DB) *gin.Engine {
	router := gin.Default()

	// The rate limiter keys on the client IP, so X-Forwarded-For is trusted only
	// from the internal proxy networks.
	err := router.SetTrustedProxies([]string{"127.0.0.0/8", "10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"})
	if err != nil {
		log.Printf("Warning: Failed to set trusted proxies: %v", err)
	}

	// CORS middleware
	router.Use(func(c *gin.Context) {
		if gin.Mode() == gin.ReleaseMode {
			// In production, the NGINX reverse proxy ensures the API and UI are on the same origin.
			// No wide-open CORS needed.
			c.Header("Access-Control-Allow-Origin", "https://hlbldr.com")
		} else {
			// In development, allow localhost origin
			c.Header("Access-Control-Allow-Origin", "*")
		}
		c.Header("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
		c.Header("Access-Control-Allow-Headers", "Origin, Content-Type, Authorization")
		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(204)
			return
		}
		c.Next()
	})

	// Health check
	healthHandler := handlers.NewHealthHandler()
	router.GET("/health", healthHandler.HealthCheck)

	// Security headers
	router.Use(middleware.SecurityHeaders())

	// Rate limiter
	rateLimiter := middleware.NewRateLimiter()

	// API routes (require database)
	if db != nil {
		if err := services.SeedCatalog(db); err != nil {
			log.Printf("Warning: failed to seed the default catalog: %v", err)
		}

		authService := services.NewAuthService(db)
		serviceService := services.NewServiceService(db)
		serviceHandler := handlers.NewServiceHandler(serviceService)
		recommendationService := services.NewRecommendationService(db)
		authHandler := handlers.NewAuthHandler(authService, rateLimiter)
		selectionService := services.NewSelectionService(db)
		selectionHandler := handlers.NewSelectionHandler(selectionService)
		adminHandler := handlers.NewAdminHandler(db, serviceService)
		hardwareService := services.NewHardwareService(db)
		hardwareHandler := handlers.NewHardwareHandler(hardwareService)
		hardwareBlueprintService := services.NewHardwareBlueprintService(db)
		hardwareBlueprintHandler := handlers.NewHardwareBlueprintHandler(hardwareBlueprintService)
		catalogCompService := services.NewCatalogComponentService(db)
		catalogCompHandler := handlers.NewCatalogComponentHandler(catalogCompService)

		buildService := services.NewBuildService(db)
		ipService := services.NewIPService(db)
		buildHandler := handlers.NewBuildHandler(buildService, ipService)
		configService := services.NewConfigService(db)
		configHandler := handlers.NewConfigHandler(configService)
		gamingService := services.NewGamingService(buildService)
		gamingHandler := handlers.NewGamingHandler(gamingService)
		proposalService := services.NewProposalService(db, buildService, ipService)
		proposalHandler := handlers.NewProposalHandler(proposalService)
		apiTokenService := services.NewAPITokenService(db)
		apiTokenHandler := handlers.NewAPITokenHandler(apiTokenService)

		// One tool registry serves both the MCP endpoint and the in-app assistant.
		assistantTools := assistant.NewRegistry(assistant.Deps{
			DB:              db,
			Builds:          buildService,
			IP:              ipService,
			Proposals:       proposalService,
			Hardware:        hardwareService,
			Services:        serviceService,
			Recommendations: recommendationService,
			Config:          configService,
			Gaming:          gamingService,
		})

		// Secrets users store here (the key of their model provider, the token
		// of their Proxmox host) are encrypted under the instance's master key.
		// A public instance must be given that key through SECRETS_KEY; without
		// it the assistant stays off and integrations take pasted exports only,
		// rather than the server refusing to start.
		var keyring *secrets.Keyring
		if cfg.AssistantEnabled || cfg.IntegrationsEnabled {
			requireEnvKey := gin.Mode() == gin.ReleaseMode && !cfg.AuthDisabled
			loaded, err := services.LoadKeyring(db, cfg.SecretsKey, cfg.SecretsKeyVersion, requireEnvKey)
			switch {
			case err != nil:
				log.Printf("Stored secrets disabled (AI assistant off, integrations read pasted exports only): %v", err)
			case loaded.Source == secrets.SourceDatabase:
				log.Printf("Stored secrets: SECRETS_KEY is not set, so provider keys and integration tokens are encrypted with a key kept in this database. Set SECRETS_KEY to keep the master key outside the database.")
				keyring = loaded
			default:
				keyring = loaded
			}
		}
		assistantSettings := services.NewAssistantSettingsService(db, keyring, cfg.AssistantEnabled, cfg.AssistantAllowPrivateEndpoints)
		assistantAgent := assistant.NewAgent(assistant.AgentDeps{
			Registry:     assistantTools,
			Settings:     assistantSettings,
			Threads:      services.NewAssistantThreadService(db),
			Proposals:    proposalService,
			Builds:       buildService,
			PublicAppURL: cfg.PublicAppURL,
		})
		assistantHandler := handlers.NewAssistantHandler(assistantSettings, assistantAgent)

		// What the user owns, and what really runs on it. An import only ever
		// proposes changes to a build that exists; the owner applies them.
		inventoryService := services.NewInventoryService(db)
		inventoryHandler := handlers.NewInventoryHandler(inventoryService)
		integrationService := services.NewIntegrationService(db, keyring, cfg.IntegrationsEnabled, cfg.IntegrationsAllowPrivateEndpoints)
		importService := services.NewProxmoxImportService(db, integrationService, buildService, ipService, proposalService)
		integrationHandler := handlers.NewIntegrationHandler(integrationService, inventoryService, importService)

		// MCP endpoint for external LLM clients. It authenticates with personal
		// access tokens, never with the browser session.
		if cfg.MCPEnabled {
			mcpHandler := mcpserver.NewHandler(mcpserver.Deps{
				Registry:       assistantTools,
				Tokens:         apiTokenService,
				PublicAppURL:   cfg.PublicAppURL,
				AllowedOrigins: cfg.MCPAllowedOrigins,
				Version:        version.Version,
			})
			router.Any("/mcp", func(c *gin.Context) {
				// gin resolves the client address through the trusted proxies above.
				request := c.Request.WithContext(mcpserver.WithClientIP(c.Request.Context(), c.ClientIP()))
				mcpHandler.ServeHTTP(c.Writer, request)
			})
		}

		requireAuth := middleware.AuthMiddleware(authService, cfg.AuthDisabled)

		// Auth routes (public & protected user)
		auth := router.Group("/auth")
		{
			auth.GET("/config", func(c *gin.Context) {
				c.JSON(200, gin.H{
					"auth_disabled":        cfg.AuthDisabled,
					"google_client_id":     cfg.GoogleClientID,
					"mcp_enabled":          cfg.MCPEnabled,
					"assistant_enabled":    cfg.AssistantEnabled,
					"integrations_enabled": cfg.IntegrationsEnabled,
				})
			})

			// Apply rate limiting to login
			auth.POST("/google", middleware.RateLimitMiddleware(rateLimiter), authHandler.GoogleLogin)

			// Backdoor for local development or self-hosted auth-disabled mode.
			if gin.Mode() != gin.ReleaseMode || cfg.AuthDisabled {
				auth.POST("/dev", authHandler.DevLogin)
			}
			auth.GET("/me", requireAuth, authHandler.GetCurrentUser)
			auth.GET("/themes", requireAuth, authHandler.GetThemeSettings)
			auth.PUT("/themes", requireAuth, authHandler.UpdateThemeSettings)
			auth.PUT("/preferences", requireAuth, authHandler.UpdatePreferences)
		}

		// Public API routes
		api := router.Group("/api")
		{
			api.GET("/services", serviceHandler.GetAll)

			// Hardware catalog (public read)
			api.GET("/hardware", hardwareHandler.GetAll)
			api.GET("/hardware/categories", hardwareHandler.GetCategories)
			api.GET("/hardware/:id", hardwareHandler.GetByID)
			api.POST("/hardware", hardwareHandler.Create) // community submission
		}

		// Protected API routes (require authentication)
		protected := api.Group("")
		protected.Use(requireAuth)
		{
			protected.GET("/selections", selectionHandler.GetSelections)
			protected.POST("/selections", selectionHandler.AddSelection)
			protected.DELETE("/selections/:id", selectionHandler.RemoveSelection)

			// Hardware Favorites
			protected.GET("/hardware/favorites", hardwareHandler.GetFavorites)
			protected.POST("/hardware/favorites", hardwareHandler.AddFavorite)
			protected.DELETE("/hardware/favorites/:id", hardwareHandler.RemoveFavorite)
			protected.GET("/hardware-blueprints", hardwareBlueprintHandler.ListMine)
			protected.POST("/hardware-blueprints", hardwareBlueprintHandler.Create)
			protected.POST("/hardware-blueprints/import", hardwareBlueprintHandler.Import)
			protected.GET("/hardware-blueprints/:id/export", hardwareBlueprintHandler.Export)
			protected.POST("/hardware-blueprints/:id/share-code", hardwareBlueprintHandler.CreateShareCode)
			protected.PATCH("/hardware-blueprints/:id/submit", hardwareBlueprintHandler.Submit)

			protected.GET("/my-services", serviceHandler.GetAllForCurrentUser)
			protected.POST("/my-services", serviceHandler.CreatePrivate)
			protected.PATCH("/my-services/:id/submit-community", serviceHandler.SubmitPrivateToCommunity)

			// Builds
			protected.GET("/builds", buildHandler.List)
			protected.POST("/builds", buildHandler.Create)
			protected.GET("/builds/:id", buildHandler.Get)
			protected.PATCH("/builds/:id", buildHandler.Rename)
			protected.PUT("/builds/:id/topology", buildHandler.UpdateTopology)
			protected.DELETE("/builds/:id", buildHandler.Delete)
			protected.POST("/builds/:id/duplicate", buildHandler.Duplicate)
			protected.POST("/builds/:id/share", buildHandler.Share)
			protected.POST("/builds/:id/unshare", buildHandler.Unshare)
			protected.PATCH("/builds/:id/share", buildHandler.SetShareEditable)
			protected.POST("/builds/:id/validate-network", buildHandler.ValidateNetwork)
			protected.POST("/builds/:id/generate-config", configHandler.GenerateConfig)
			protected.GET("/builds/:id/export-bundle", configHandler.DownloadBundle)
			protected.GET("/builds/:id/gaming-report", gamingHandler.Report)

			// LLM proposals: change sets wait here until the owner applies them.
			protected.GET("/builds/:id/sync-state", proposalHandler.SyncState)
			protected.GET("/builds/:id/proposals/:pid", proposalHandler.Get)
			protected.POST("/builds/:id/proposals/:pid/apply", proposalHandler.Apply)
			protected.POST("/builds/:id/proposals/:pid/reject", proposalHandler.Reject)

			// Personal access tokens for MCP clients. Session auth only: a token
			// cannot create or revoke tokens.
			protected.GET("/tokens", apiTokenHandler.List)
			protected.POST("/tokens", apiTokenHandler.Create)
			protected.DELETE("/tokens/:id", apiTokenHandler.Revoke)

			// In-app assistant: bring-your-own-key settings and the chat stream.
			protected.GET("/assistant/settings", assistantHandler.GetSettings)
			protected.PUT("/assistant/settings", assistantHandler.UpdateSettings)
			protected.DELETE("/assistant/settings", assistantHandler.ResetSettings)
			protected.DELETE("/assistant/settings/key", assistantHandler.DeleteKey)
			protected.POST("/assistant/settings/test", assistantHandler.TestSettings)
			protected.GET("/assistant/threads/:buildId", assistantHandler.GetThread)
			protected.DELETE("/assistant/threads/:buildId", assistantHandler.ClearThread)
			protected.POST("/assistant/chat", assistantHandler.Chat)

			// Inventory: the hardware the user owns. It belongs to the account.
			protected.GET("/inventory", inventoryHandler.List)
			protected.POST("/inventory", inventoryHandler.Create)
			protected.PUT("/inventory/:id", inventoryHandler.Update)
			protected.DELETE("/inventory/:id", inventoryHandler.Delete)

			// Integrations: read-only connections to Proxmox. Session auth only,
			// like the token routes: an access token cannot reach a stored secret.
			protected.GET("/integrations", integrationHandler.List)
			protected.POST("/integrations", integrationHandler.Create)
			protected.POST("/integrations/test", integrationHandler.Test)
			protected.PUT("/integrations/:id", integrationHandler.Update)
			protected.DELETE("/integrations/:id", integrationHandler.Delete)
			protected.POST("/integrations/:id/sync", integrationHandler.Sync)
			protected.POST("/integrations/:id/reconcile", integrationHandler.Reconcile)
			protected.POST("/integrations/:id/link", integrationHandler.Link)
			protected.POST("/integrations/:id/inventory", integrationHandler.CreateItem)
			protected.POST("/integrations/:id/import", integrationHandler.Import)

			// Public shared build viewer / editor (no auth required)
			api.GET("/shared/:token", buildHandler.GetShared)
			api.PUT("/shared/:token", buildHandler.UpdateShared)

			// Beta Survey (BETA_SURVEY - remove after beta)
			surveyHandler := handlers.NewSurveyHandler(db)
			protected.GET("/survey", surveyHandler.GetSurvey)
			protected.POST("/survey", surveyHandler.SubmitSurvey)
			protected.PUT("/survey", surveyHandler.UpdateSurvey)
		}

		// Admin routes (require authentication + admin role)
		admin := api.Group("/admin")
		admin.Use(middleware.AuthMiddlewareWithUser(authService, cfg.AuthDisabled))
		admin.Use(middleware.AdminRequired())
		{
			admin.GET("/dashboard", adminHandler.Dashboard)
			admin.GET("/export-anonymized-topologies", adminHandler.ExportAnonymizedTopologies)
			admin.GET("/users", adminHandler.ListUsers)
			admin.GET("/services", adminHandler.ListAllServices)
			admin.POST("/services", serviceHandler.Create)
			admin.PUT("/services/:id", adminHandler.UpdateServiceFull)
			admin.DELETE("/services/:id", adminHandler.DeleteService)

			// Hardware admin
			admin.GET("/hardware", hardwareHandler.AdminGetAll)
			admin.POST("/hardware", hardwareHandler.AdminCreate)
			admin.PUT("/hardware/:id", hardwareHandler.AdminUpdate)
			admin.DELETE("/hardware/:id", hardwareHandler.AdminDelete)
			admin.PATCH("/hardware/:id/approve", hardwareHandler.AdminApprove)
			admin.POST("/hardware/bulk-import", hardwareHandler.AdminBulkImport)
			admin.GET("/hardware-blueprints", hardwareBlueprintHandler.AdminListPending)
			admin.PATCH("/hardware-blueprints/:id/moderate", hardwareBlueprintHandler.AdminModerate)

			// Catalog Components (Mass Planner)
			admin.GET("/catalog-components", catalogCompHandler.GetAll)
			admin.POST("/catalog-components", catalogCompHandler.Create)
			admin.PUT("/catalog-components/:id", catalogCompHandler.Update)
			admin.DELETE("/catalog-components/:id", catalogCompHandler.Delete)
		}
	}

	return router
}
