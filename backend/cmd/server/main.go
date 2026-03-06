package main

import (
	"fmt"
	"log"

	"github.com/Butterski/homelab-builder/backend/internal/config"
	"github.com/Butterski/homelab-builder/backend/internal/handlers"
	"github.com/Butterski/homelab-builder/backend/internal/middleware"
	"github.com/Butterski/homelab-builder/backend/internal/services"
	"github.com/Butterski/homelab-builder/backend/pkg/database"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

func main() {
	log.Println("Starting HLBuilder Backend...")
	cfg := config.Load()

	db, err := database.Connect(cfg)
	if err != nil {
		log.Printf("Warning: Failed to connect to database: %v", err)
		log.Println("Starting server without database connection...")
		router := setupRouter(cfg, nil)
		startServer(router, cfg.ServerPort)
		return
	}

	log.Println("Database connected. Setting up routes...")

	router := setupRouter(cfg, db)
	startServer(router, cfg.ServerPort)
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

	// SECURITY FIX: Prevent IP spoofing in Rate Limiter.
	// We only trust the X-Forwarded-For header if it comes from our internal Nginx Docker network.
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
		c.Header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
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
		authService := services.NewAuthService(db)
		serviceService := services.NewServiceService(db)
		serviceHandler := handlers.NewServiceHandler(serviceService)
		recommendationService := services.NewRecommendationService(db)
		recommendationHandler := handlers.NewRecommendationHandler(recommendationService)
		shoppingService := services.NewShoppingListService(db)
		shoppingHandler := handlers.NewShoppingListHandler(shoppingService)
		authHandler := handlers.NewAuthHandler(authService, rateLimiter)
		selectionService := services.NewSelectionService(db)
		selectionHandler := handlers.NewSelectionHandler(selectionService)
		adminHandler := handlers.NewAdminHandler(db, serviceService)
		hardwareService := services.NewHardwareService(db)
		hardwareHandler := handlers.NewHardwareHandler(hardwareService)
		steeringService := services.NewSteeringService(db)
		steeringHandler := handlers.NewSteeringHandler(steeringService)
		catalogCompService := services.NewCatalogComponentService(db)
		catalogCompHandler := handlers.NewCatalogComponentHandler(catalogCompService)
		_ = services.NewAnalyticsService(db) // available for future handler integration

		// Auth routes (public & protected user)
		auth := router.Group("/auth")
		{
			// Apply rate limiting to login
			auth.POST("/google", middleware.RateLimitMiddleware(rateLimiter), authHandler.GoogleLogin)

			// Backdoor for local development - disable in production
			if gin.Mode() != gin.ReleaseMode {
				auth.POST("/dev", authHandler.DevLogin)
			}
			auth.GET("/me", middleware.AuthMiddleware(authService, cfg.AuthDisabled), authHandler.GetCurrentUser)
			auth.PUT("/preferences", middleware.AuthMiddleware(authService, cfg.AuthDisabled), authHandler.UpdatePreferences)
		}

		// Public API routes
		api := router.Group("/api")
		{
			api.GET("/services", serviceHandler.GetAll)
			api.GET("/services/:id", serviceHandler.GetByID)
			api.POST("/services", serviceHandler.Create)
			api.POST("/services/community", serviceHandler.SubmitCommunity) // community submission
			api.PUT("/services/:id", serviceHandler.Update)
			api.DELETE("/services/:id", serviceHandler.Delete)

			api.POST("/recommendations", recommendationHandler.Generate)
			api.POST("/shopping-list", shoppingHandler.Generate)

			// Hardware catalog (public read)
			api.GET("/hardware", hardwareHandler.GetAll)
			api.GET("/hardware/categories", hardwareHandler.GetCategories)
			api.GET("/hardware/brands", hardwareHandler.GetBrands)
			api.GET("/hardware/:id", hardwareHandler.GetByID)
			api.POST("/hardware/:id/like", hardwareHandler.Like)
			api.POST("/hardware", hardwareHandler.Create) // community submission

			// Component Catalog
			api.GET("/catalog-components", catalogCompHandler.GetAll)
		}

		// Protected API routes (require authentication)
		protected := api.Group("")
		protected.Use(middleware.AuthMiddleware(authService, cfg.AuthDisabled))
		{
			protected.GET("/selections", selectionHandler.GetSelections)
			protected.POST("/selections", selectionHandler.AddSelection)
			protected.DELETE("/selections/:id", selectionHandler.RemoveSelection)

			// Builds
			buildService := services.NewBuildService(db)
			ipService := services.NewIPService(db)
			buildHandler := handlers.NewBuildHandler(buildService, ipService)
			configService := services.NewConfigService(db)
			configHandler := handlers.NewConfigHandler(configService)

			protected.GET("/builds", buildHandler.List)
			protected.POST("/builds", buildHandler.Create)
			protected.GET("/builds/:id", buildHandler.Get)
			protected.PUT("/builds/:id", buildHandler.Update)
			protected.DELETE("/builds/:id", buildHandler.Delete)
			protected.POST("/builds/:id/duplicate", buildHandler.Duplicate)
			protected.POST("/builds/:id/calculate-network", buildHandler.CalculateNetwork)
			protected.POST("/builds/:id/validate-network", buildHandler.ValidateNetwork)
			protected.POST("/builds/:id/generate-config", configHandler.GenerateConfig)

			// Beta Survey (BETA_SURVEY - remove after beta)
			surveyHandler := handlers.NewSurveyHandler(db)
			protected.GET("/survey", surveyHandler.GetSurvey)
			protected.POST("/survey", surveyHandler.SubmitSurvey)
			protected.PUT("/survey", surveyHandler.UpdateSurvey)
		}

		// Admin routes (require authentication + admin role)
		admin := api.Group("/admin")
		// Use AuthMiddlewareWithUser to load the full User model so is_admin check works
		admin.Use(middleware.AuthMiddlewareWithUser(authService, db, cfg.AuthDisabled))
		admin.Use(middleware.AdminRequired())
		{
			admin.GET("/dashboard", adminHandler.Dashboard)
			admin.GET("/users", adminHandler.ListUsers)
			admin.GET("/services", adminHandler.ListAllServices)
			admin.POST("/services/:id/toggle", adminHandler.ToggleServiceActive)
			admin.PUT("/services/:id", adminHandler.UpdateServiceFull)
			admin.DELETE("/services/:id", adminHandler.DeleteService)
			admin.GET("/events", adminHandler.RecentEvents)

			// Hardware admin
			admin.GET("/hardware", hardwareHandler.AdminGetAll)
			admin.POST("/hardware", hardwareHandler.AdminCreate)
			admin.PUT("/hardware/:id", hardwareHandler.AdminUpdate)
			admin.DELETE("/hardware/:id", hardwareHandler.AdminDelete)
			admin.PATCH("/hardware/:id/approve", hardwareHandler.AdminApprove)
			admin.PATCH("/hardware/:id/buy-urls", hardwareHandler.AdminUpdateBuyURLs)
			admin.POST("/hardware/bulk-import", hardwareHandler.AdminBulkImport)

			// Steering rules
			admin.GET("/steering", steeringHandler.GetAll)
			admin.PUT("/steering/:category", steeringHandler.Upsert)
			admin.DELETE("/steering/:category", steeringHandler.Delete)

			// Catalog Components (Mass Planner)
			admin.GET("/catalog-components", catalogCompHandler.GetAll)
			admin.POST("/catalog-components", catalogCompHandler.Create)
			admin.PUT("/catalog-components/:id", catalogCompHandler.Update)
			admin.DELETE("/catalog-components/:id", catalogCompHandler.Delete)
		}
	}

	return router
}
