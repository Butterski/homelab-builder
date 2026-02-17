package main

import (
	"fmt"
	"log"

	"github.com/Butterski/homelab-builder/backend/internal/config"
	"github.com/Butterski/homelab-builder/backend/internal/handlers"
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

	// API routes (require database)
	if db != nil {
		serviceService := services.NewServiceService(db)
		serviceHandler := handlers.NewServiceHandler(serviceService)

		recommendationService := services.NewRecommendationService(db)
		recommendationHandler := handlers.NewRecommendationHandler(recommendationService)

		api := router.Group("/api")
		{
			api.GET("/services", serviceHandler.GetAll)
			api.GET("/services/:id", serviceHandler.GetByID)
			api.POST("/services", serviceHandler.Create)
			api.PUT("/services/:id", serviceHandler.Update)
			api.DELETE("/services/:id", serviceHandler.Delete)

			api.POST("/recommendations", recommendationHandler.Generate)
		}
	}

	return router
}
