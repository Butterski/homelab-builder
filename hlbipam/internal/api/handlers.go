package api

import (
	"encoding/json"
	"io"
	"net/http"

	"github.com/Butterski/hlbipam/internal/core"
	"github.com/Butterski/hlbipam/internal/models"
)

// RegisterRoutes wires the IPAM endpoints onto the provided mux.
func RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("POST /api/v1/allocate", handleRequest(core.Allocate))
	mux.HandleFunc("POST /api/v1/validate", handleRequest(core.Validate))
	mux.HandleFunc("GET /health", handleHealth)
}

// handleRequest serves an endpoint that decodes an AllocateRequest and answers
// with whatever run computes from it.
func handleRequest[T any](run func(models.AllocateRequest) T) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req models.AllocateRequest
		if err := decodeBody(r, &req); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, run(req))
	}
}

func handleHealth(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func decodeBody(r *http.Request, dst interface{}) error {
	body, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	if err != nil {
		return err
	}
	return json.Unmarshal(body, dst)
}

func writeJSON(w http.ResponseWriter, status int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v) //nolint:errcheck
}
