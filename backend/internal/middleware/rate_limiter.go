package middleware

import (
	"net/http"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

const (
	MaxLoginAttempts = 6
	LockoutDuration  = 15 * time.Minute
	CleanupInterval  = 10 * time.Minute
)

type attemptRecord struct {
	count     int
	firstFail time.Time
	lockedAt  time.Time
}

type RateLimiter struct {
	mu       sync.RWMutex
	attempts map[string]*attemptRecord
}

func NewRateLimiter() *RateLimiter {
	rl := &RateLimiter{
		attempts: make(map[string]*attemptRecord),
	}
	// Background cleanup of expired entries
	go func() {
		ticker := time.NewTicker(CleanupInterval)
		defer ticker.Stop()
		for range ticker.C {
			rl.cleanup()
		}
	}()
	return rl
}

// IsBlocked checks if an IP is currently locked out.
// Returns true if the IP is blocked (caller should return a fake error).
func (rl *RateLimiter) IsBlocked(ip string) bool {
	rl.mu.RLock()
	defer rl.mu.RUnlock()

	rec, exists := rl.attempts[ip]
	if !exists {
		return false
	}

	// Check if lockout has expired
	if !rec.lockedAt.IsZero() && time.Since(rec.lockedAt) < LockoutDuration {
		return true
	}

	return false
}

// RecordFailure records a failed login attempt and returns true if the IP
// is now locked out (hit the threshold).
func (rl *RateLimiter) RecordFailure(ip string) bool {
	rl.mu.Lock()
	defer rl.mu.Unlock()

	rec, exists := rl.attempts[ip]
	if !exists {
		rl.attempts[ip] = &attemptRecord{
			count:     1,
			firstFail: time.Now(),
		}
		return false
	}

	// If previous lockout expired, reset
	if !rec.lockedAt.IsZero() && time.Since(rec.lockedAt) >= LockoutDuration {
		rec.count = 1
		rec.firstFail = time.Now()
		rec.lockedAt = time.Time{}
		return false
	}

	rec.count++
	if rec.count >= MaxLoginAttempts {
		rec.lockedAt = time.Now()
		return true
	}

	return false
}

// ClearAttempts resets the attempt counter on successful login.
func (rl *RateLimiter) ClearAttempts(ip string) {
	rl.mu.Lock()
	defer rl.mu.Unlock()
	delete(rl.attempts, ip)
}

func (rl *RateLimiter) cleanup() {
	rl.mu.Lock()
	defer rl.mu.Unlock()

	now := time.Now()
	for ip, rec := range rl.attempts {
		// Remove entries where lockout expired or no activity for > lockout duration
		if !rec.lockedAt.IsZero() && now.Sub(rec.lockedAt) > LockoutDuration*2 {
			delete(rl.attempts, ip)
		} else if rec.lockedAt.IsZero() && now.Sub(rec.firstFail) > LockoutDuration {
			delete(rl.attempts, ip)
		}
	}
}

// RateLimitMiddleware applies rate limiting to specific endpoints.
// For the login endpoint, after 6 failed attempts the response is always
// "Invalid credentials" — even for valid logins — so attackers can't
// distinguish success from failure during lockout.
func RateLimitMiddleware(rl *RateLimiter) gin.HandlerFunc {
	return func(c *gin.Context) {
		ip := c.ClientIP()

		if rl.IsBlocked(ip) {
			// Always return the same error — attacker thinks credentials are wrong
			c.JSON(http.StatusUnauthorized, gin.H{
				"error": "Invalid credentials",
				"code":  "invalid_credentials",
			})
			c.Abort()
			return
		}

		c.Next()
	}
}
