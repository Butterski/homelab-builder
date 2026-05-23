package handlers

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/Butterski/homelab-builder/backend/internal/middleware"
	"github.com/Butterski/homelab-builder/backend/internal/models"
	"github.com/Butterski/homelab-builder/backend/internal/services"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

func TestBuildHandler_Get_Authorization(t *testing.T) {
	tx := handlersTestTx(t)
	buildSvc := services.NewBuildService(tx)
	ipSvc := services.NewIPService(tx)
	handler := NewBuildHandler(buildSvc, ipSvc)

	// Create user 1 and their build
	user1 := models.User{GoogleID: "u1-" + uuid.NewString(), Email: uuid.NewString() + "@u1.com", Name: "U1"}
	tx.Create(&user1)
	build1, _ := buildSvc.Create(user1.ID, services.SyncGraphInput{Name: "P1"})

	// Create user 2 (the attacker/other user)
	user2 := models.User{GoogleID: "u2-" + uuid.NewString(), Email: uuid.NewString() + "@u2.com", Name: "U2"}
	tx.Create(&user2)

	// 1. Try to fetch user 1's build as user 2 (attacker)
	req, _ := http.NewRequest(http.MethodGet, "/api/builds/"+build1.ID.String(), nil)
	recorder := httptest.NewRecorder()
	ctx, _ := ginCreateTestContext(recorder, req)
	ctx.Params = gin.Params{{Key: "id", Value: build1.ID.String()}}
	ctx.Set("user_id", user2.ID)

	handler.Get(ctx)

	if recorder.Code != http.StatusForbidden {
		t.Errorf("expected Get to return 403 Forbidden, got %d", recorder.Code)
	}

	// 2. Try to fetch user 1's build as user 1 (owner)
	req2, _ := http.NewRequest(http.MethodGet, "/api/builds/"+build1.ID.String(), nil)
	recorder2 := httptest.NewRecorder()
	ctx2, _ := ginCreateTestContext(recorder2, req2)
	ctx2.Params = gin.Params{{Key: "id", Value: build1.ID.String()}}
	ctx2.Set("user_id", user1.ID)

	handler.Get(ctx2)

	if recorder2.Code != http.StatusOK {
		t.Errorf("expected Get to return 200 OK, got %d", recorder2.Code)
	}
}

func TestBuildHandler_CalculateNetwork_Authorization(t *testing.T) {
	tx := handlersTestTx(t)
	buildSvc := services.NewBuildService(tx)
	ipSvc := services.NewIPService(tx)
	handler := NewBuildHandler(buildSvc, ipSvc)

	user1 := models.User{GoogleID: "u1-" + uuid.NewString(), Email: uuid.NewString() + "@u1.com", Name: "U1"}
	tx.Create(&user1)
	build1, _ := buildSvc.Create(user1.ID, services.SyncGraphInput{Name: "P1"})

	user2 := models.User{GoogleID: "u2-" + uuid.NewString(), Email: uuid.NewString() + "@u2.com", Name: "U2"}
	tx.Create(&user2)

	// Try to calculate network for user 1's build as user 2
	req, _ := http.NewRequest(http.MethodPost, "/api/builds/"+build1.ID.String()+"/calculate-network", nil)
	recorder := httptest.NewRecorder()
	ctx, _ := ginCreateTestContext(recorder, req)
	ctx.Params = gin.Params{{Key: "id", Value: build1.ID.String()}}
	ctx.Set("user_id", user2.ID)

	handler.CalculateNetwork(ctx)

	if recorder.Code != http.StatusForbidden {
		t.Errorf("expected CalculateNetwork to return 403 Forbidden, got %d", recorder.Code)
	}
}

func TestBuildHandler_ValidateNetwork_Authorization(t *testing.T) {
	tx := handlersTestTx(t)
	buildSvc := services.NewBuildService(tx)
	ipSvc := services.NewIPService(tx)
	handler := NewBuildHandler(buildSvc, ipSvc)

	user1 := models.User{GoogleID: "u1-" + uuid.NewString(), Email: uuid.NewString() + "@u1.com", Name: "U1"}
	tx.Create(&user1)
	build1, _ := buildSvc.Create(user1.ID, services.SyncGraphInput{Name: "P1"})

	user2 := models.User{GoogleID: "u2-" + uuid.NewString(), Email: uuid.NewString() + "@u2.com", Name: "U2"}
	tx.Create(&user2)

	// Try to validate network for user 1's build as user 2
	req, _ := http.NewRequest(http.MethodPost, "/api/builds/"+build1.ID.String()+"/validate-network", nil)
	recorder := httptest.NewRecorder()
	ctx, _ := ginCreateTestContext(recorder, req)
	ctx.Params = gin.Params{{Key: "id", Value: build1.ID.String()}}
	ctx.Set("user_id", user2.ID)

	handler.ValidateNetwork(ctx)

	if recorder.Code != http.StatusForbidden {
		t.Errorf("expected ValidateNetwork to return 403 Forbidden, got %d", recorder.Code)
	}
}

func TestConfigHandler_GenerateConfig_Authorization(t *testing.T) {
	tx := handlersTestTx(t)
	buildSvc := services.NewBuildService(tx)
	configSvc := services.NewConfigService(tx)
	handler := NewConfigHandler(configSvc)

	user1 := models.User{GoogleID: "u1-" + uuid.NewString(), Email: uuid.NewString() + "@u1.com", Name: "U1"}
	tx.Create(&user1)
	// Create build with at least 1 VM so Docker Compose isn't empty services
	build1, _ := buildSvc.Create(user1.ID, services.SyncGraphInput{
		Name: "P1",
		Nodes: []services.NodeDTO{
			{ID: uuid.NewString(), Type: "server", Name: "S1", VMs: []services.VMDTO{{ID: uuid.NewString(), Type: "container", Name: "Pi-hole"}}},
		},
	})

	user2 := models.User{GoogleID: "u2-" + uuid.NewString(), Email: uuid.NewString() + "@u2.com", Name: "U2"}
	tx.Create(&user2)

	// Try to generate config for user 1's build as user 2
	req, _ := http.NewRequest(http.MethodPost, "/api/builds/"+build1.ID.String()+"/generate-config", nil)
	recorder := httptest.NewRecorder()
	ctx, _ := ginCreateTestContext(recorder, req)
	ctx.Params = gin.Params{{Key: "id", Value: build1.ID.String()}}
	ctx.Set("user_id", user2.ID)

	handler.GenerateConfig(ctx)

	if recorder.Code != http.StatusForbidden {
		t.Errorf("expected GenerateConfig to return 403 Forbidden, got %d body=%s", recorder.Code, recorder.Body.String())
	}
}

func TestMiddleware_AdminRequired(t *testing.T) {
	tx := handlersTestTx(t)
	// 1. Create a non-admin user
	nonAdmin := models.User{GoogleID: "non-admin-" + uuid.NewString(), Email: "na@t.com", IsAdmin: false}
	tx.Create(&nonAdmin)

	req, _ := http.NewRequest(http.MethodPost, "/api/admin/services", nil)
	recorder := httptest.NewRecorder()
	ctx, _ := ginCreateTestContext(recorder, req)
	ctx.Set("user", &nonAdmin)

	// Call the AdminRequired middleware
	middleware.AdminRequired()(ctx)

	if recorder.Code != http.StatusForbidden {
		t.Errorf("expected AdminRequired to block non-admin with 403 Forbidden, got %d", recorder.Code)
	}

	// 2. Create an admin user
	admin := models.User{GoogleID: "admin-" + uuid.NewString(), Email: "a@t.com", IsAdmin: true}
	tx.Create(&admin)

	req2, _ := http.NewRequest(http.MethodPost, "/api/admin/services", nil)
	recorder2 := httptest.NewRecorder()
	ctx2, _ := ginCreateTestContext(recorder2, req2)
	ctx2.Set("user", &admin)

	middleware.AdminRequired()(ctx2)

	if recorder2.Code != 0 && recorder2.Code != http.StatusOK {
		t.Errorf("expected AdminRequired to allow admin user, got code %d", recorder2.Code)
	}
}
