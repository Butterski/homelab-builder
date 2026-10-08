package main

import (
	"log"
	"net/http"
	"os"

	"github.com/Butterski/hlbipam/internal/api"
)

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8081"
	}

	mux := http.NewServeMux()
	api.RegisterRoutes(mux)

	// Wrap with CORS headers for direct frontend calls.
	handler := corsMiddleware(mux)

	log.Printf("hlbIPAM starting on :%s", port)
	if err := http.ListenAndServe(":"+port, handler); err != nil {
		log.Fatalf("server error: %v", err)
	}
}

// corsMiddleware adds permissive CORS headers for development.
func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")

		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}

		next.ServeHTTP(w, r)
	})
}
