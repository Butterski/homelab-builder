package mcpserver

import (
	"sync"
	"time"

	"golang.org/x/time/rate"
)

const (
	limiterIdleAfter  = 10 * time.Minute
	limiterSweepAbove = 2048
)

// keyedLimiter keeps one token bucket per key (a token id or a client address).
// Buckets are in memory: limits apply per backend instance.
type keyedLimiter struct {
	mu      sync.Mutex
	limit   rate.Limit
	burst   int
	entries map[string]*limiterEntry
}

type limiterEntry struct {
	limiter *rate.Limiter
	seen    time.Time
}

func newKeyedLimiter(perMinute, burst int) *keyedLimiter {
	return &keyedLimiter{
		limit:   rate.Limit(float64(perMinute) / 60),
		burst:   burst,
		entries: map[string]*limiterEntry{},
	}
}

func (k *keyedLimiter) get(key string) *rate.Limiter {
	k.mu.Lock()
	defer k.mu.Unlock()
	now := time.Now()
	if len(k.entries) > limiterSweepAbove {
		for existing, entry := range k.entries {
			if now.Sub(entry.seen) > limiterIdleAfter {
				delete(k.entries, existing)
			}
		}
	}
	entry, ok := k.entries[key]
	if !ok {
		entry = &limiterEntry{limiter: rate.NewLimiter(k.limit, k.burst)}
		k.entries[key] = entry
	}
	entry.seen = now
	return entry.limiter
}

// allow spends one unit of the key's budget and reports whether it was available.
func (k *keyedLimiter) allow(key string) bool {
	return k.get(key).Allow()
}

// exhausted reports whether the key has no budget left, without spending any.
func (k *keyedLimiter) exhausted(key string) bool {
	return k.get(key).Tokens() < 1
}
