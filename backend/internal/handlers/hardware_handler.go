package handlers

import (
	"net/http"
	"strconv"

	"github.com/Butterski/homelab-builder/backend/internal/services"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

type HardwareHandler struct {
	svc *services.HardwareService
}

func NewHardwareHandler(svc *services.HardwareService) *HardwareHandler {
	return &HardwareHandler{svc: svc}
}

// GET /api/hardware?category=router&brand=Ubiquiti&search=dream&min_price=100&max_price=500&limit=50&offset=0
func (h *HardwareHandler) GetAll(c *gin.Context) {
	f := hardwareFilter(c)

	result, err := h.svc.GetAll(f)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch hardware components"})
		return
	}
	c.JSON(http.StatusOK, result)
}

// hardwareFilter reads the catalog query; malformed numbers count as unset.
func hardwareFilter(c *gin.Context) services.HardwareFilter {
	minPrice, _ := strconv.ParseFloat(c.Query("min_price"), 64)
	maxPrice, _ := strconv.ParseFloat(c.Query("max_price"), 64)
	limit, _ := strconv.Atoi(c.Query("limit"))
	offset, _ := strconv.Atoi(c.Query("offset"))

	return services.HardwareFilter{
		Category: c.Query("category"),
		Brand:    c.Query("brand"),
		Search:   c.Query("search"),
		MinPrice: minPrice,
		MaxPrice: maxPrice,
		Limit:    limit,
		Offset:   offset,
	}
}

// GET /api/hardware/:id
func (h *HardwareHandler) GetByID(c *gin.Context) {
	id, ok := uuidParam(c, "id")
	if !ok {
		return
	}
	comp, err := h.svc.GetByID(id)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Component not found"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": comp})
}

// GET /api/hardware/categories
func (h *HardwareHandler) GetCategories(c *gin.Context) {
	cats, err := h.svc.GetCategories()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch categories"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": cats})
}

// POST /api/hardware  (community submission - auto-approve=false)
func (h *HardwareHandler) Create(c *gin.Context) {
	h.create(c, false, "Failed to submit component")
}

// POST /api/admin/hardware  (admin - auto-approve=true)
func (h *HardwareHandler) AdminCreate(c *gin.Context) {
	h.create(c, true, "Failed to create component")
}

func (h *HardwareHandler) create(c *gin.Context, approve bool, failure string) {
	var input services.CreateHardwareInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request body"})
		return
	}
	comp, err := h.svc.Create(input, nil, approve)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": failure})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"data": comp})
}

// PUT /api/admin/hardware/:id
func (h *HardwareHandler) AdminUpdate(c *gin.Context) {
	id, ok := uuidParam(c, "id")
	if !ok {
		return
	}
	var input services.CreateHardwareInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request body"})
		return
	}
	comp, err := h.svc.Update(id, input)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update component"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": comp})
}

// DELETE /api/admin/hardware/:id
func (h *HardwareHandler) AdminDelete(c *gin.Context) {
	id, ok := uuidParam(c, "id")
	if !ok {
		return
	}
	if err := h.svc.Delete(id); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to delete component"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "Deleted"})
}

// PATCH /api/admin/hardware/:id/approve
func (h *HardwareHandler) AdminApprove(c *gin.Context) {
	id, ok := uuidParam(c, "id")
	if !ok {
		return
	}
	var body struct {
		Approved bool `json:"approved"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request body"})
		return
	}
	if err := h.svc.Approve(id, body.Approved); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update approval"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "Updated"})
}

// POST /api/admin/hardware/bulk-import
func (h *HardwareHandler) AdminBulkImport(c *gin.Context) {
	var items []services.CreateHardwareInput
	if err := c.ShouldBindJSON(&items); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request body. Expected JSON array."})
		return
	}
	if len(items) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Empty array"})
		return
	}
	if len(items) > 500 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Maximum 500 items per import"})
		return
	}
	count, err := h.svc.BulkImport(items, nil)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Bulk import failed"})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"imported": count})
}

// GET /api/admin/hardware?approved=false  (pending moderation)
func (h *HardwareHandler) AdminGetAll(c *gin.Context) {
	f := hardwareFilter(c)

	// Admin can see unapproved items too
	if approvedStr := c.Query("approved"); approvedStr != "" {
		approved := approvedStr == "true"
		f.Approved = &approved
	}

	result, err := h.svc.GetAll(f)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch hardware components"})
		return
	}
	c.JSON(http.StatusOK, result)
}

// GET /api/hardware/favorites
func (h *HardwareHandler) GetFavorites(c *gin.Context) {
	userID, ok := currentUser(c)
	if !ok {
		return
	}
	favs, err := h.svc.GetHardwareFavorites(userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch hardware favorites"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": favs})
}

// POST /api/hardware/favorites
func (h *HardwareHandler) AddFavorite(c *gin.Context) {
	userID, ok := currentUser(c)
	if !ok {
		return
	}

	var body struct {
		HardwareComponentID uuid.UUID `json:"hardware_component_id" binding:"required"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid hardware component ID"})
		return
	}

	fav, err := h.svc.AddHardwareFavorite(userID, body.HardwareComponentID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"data": fav})
}

// DELETE /api/hardware/favorites/:id
func (h *HardwareHandler) RemoveFavorite(c *gin.Context) {
	userID, ok := currentUser(c)
	if !ok {
		return
	}

	componentID, ok := uuidParam(c, "id")
	if !ok {
		return
	}

	if err := h.svc.RemoveHardwareFavorite(userID, componentID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "Favorite removed"})
}
