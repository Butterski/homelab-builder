// Command fakellm serves a scripted stand-in for a model provider, so the
// in-app assistant can be tried out without a key and without a model.
//
// Run it next to a local stack and point the assistant at it in Settings:
// provider "OpenAI-compatible", endpoint http://<host>:8089/v1, model
// "scripted-1", any key. internal/llm/llmtest says what it answers to.
//
// It is a development tool: it has no authentication and answers anyone.
package main

import (
	"flag"
	"log"
	"net/http"
	"time"

	"github.com/Butterski/homelab-builder/backend/internal/llm/llmtest"
)

func main() {
	addr := flag.String("addr", ":8089", "address to listen on")
	delay := flag.Duration("delay", 60*time.Millisecond, "pause between two pieces of a streamed reply")
	flag.Parse()

	server := &http.Server{
		Addr:              *addr,
		Handler:           llmtest.NewHandler(llmtest.Options{Delay: *delay}),
		ReadHeaderTimeout: 10 * time.Second,
	}
	log.Printf("scripted model provider listening on %s (model %q, %s between pieces)", *addr, llmtest.Model, *delay)
	log.Fatal(server.ListenAndServe())
}
