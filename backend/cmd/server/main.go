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
	cfg := config.Load()

	db, err := database.Connect(cfg.DatabaseDSN())
	if err != nil {
		log.Printf("Warning: Failed to connect to database: %v", err)
		log.Println("Starting server without database connection...")
		router := setupRouter(nil)
		startServer(router, cfg.ServerPort)
		return
	}

	router := setupRouter(db)
	startServer(router, cfg.ServerPort)
}

func startServer(router *gin.Engine, port string) {
	addr := fmt.Sprintf(":%s", port)
	log.Printf("Starting server on %s", addr)
	if err := router.Run(addr); err != nil {
		log.Fatalf("Failed to start server: %v", err)
	}
}

func setupRouter(db *gorm.DB) *gin.Engine {
	router := gin.Default()

	// CORS middleware
	router.Use(func(c *gin.Context) {
		c.Header("Access-Control-Allow-Origin", "*")
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
		_ = services.NewAnalyticsService(db) // available for future handler integration

		// Auth routes (public)
		auth := router.Group("/auth")
		{
			// Apply rate limiting to login
			auth.POST("/google", middleware.RateLimitMiddleware(rateLimiter), authHandler.GoogleLogin)
			auth.GET("/me", middleware.AuthMiddleware(authService), authHandler.GetCurrentUser)
		}

		// Public API routes
		api := router.Group("/api")
		{
			api.GET("/services", serviceHandler.GetAll)
			api.GET("/services/:id", serviceHandler.GetByID)
			api.POST("/services", serviceHandler.Create)
			api.PUT("/services/:id", serviceHandler.Update)
			api.DELETE("/services/:id", serviceHandler.Delete)

			api.POST("/recommendations", recommendationHandler.Generate)
			api.POST("/shopping-list", shoppingHandler.Generate)
		}

		// Protected API routes (require authentication)
		protected := api.Group("")
		protected.Use(middleware.AuthMiddleware(authService))
		{
			protected.GET("/selections", selectionHandler.GetSelections)
			protected.POST("/selections", selectionHandler.AddSelection)
			protected.DELETE("/selections/:id", selectionHandler.RemoveSelection)
		}

		// Admin routes (require authentication + admin role)
		admin := router.Group("/admin")
		// Use AuthMiddlewareWithUser to load the full User model so is_admin check works
		admin.Use(middleware.AuthMiddlewareWithUser(authService, db))
		admin.Use(middleware.AdminRequired())
		{
			admin.GET("/dashboard", adminHandler.Dashboard)
			admin.GET("/users", adminHandler.ListUsers)
			admin.GET("/services", adminHandler.ListAllServices)
			admin.POST("/services/:id/toggle", adminHandler.ToggleServiceActive)
			admin.GET("/events", adminHandler.RecentEvents)
		}
	}

	return router
}
