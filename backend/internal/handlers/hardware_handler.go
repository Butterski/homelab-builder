package handlers

import (
	"encoding/json"
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
	minPrice, _ := strconv.ParseFloat(c.Query("min_price"), 64)
	maxPrice, _ := strconv.ParseFloat(c.Query("max_price"), 64)
	limit, _ := strconv.Atoi(c.Query("limit"))
	offset, _ := strconv.Atoi(c.Query("offset"))

	f := services.HardwareFilter{
		Category: c.Query("category"),
		Brand:    c.Query("brand"),
		Search:   c.Query("search"),
		MinPrice: minPrice,
		MaxPrice: maxPrice,
		Limit:    limit,
		Offset:   offset,
	}

	result, err := h.svc.GetAll(f)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch hardware components"})
		return
	}
	c.JSON(http.StatusOK, result)
}

// GET /api/hardware/:id
func (h *HardwareHandler) GetByID(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid ID"})
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

// GET /api/hardware/brands?category=router
func (h *HardwareHandler) GetBrands(c *gin.Context) {
	brands, err := h.svc.GetBrands(c.Query("category"))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch brands"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": brands})
}

// POST /api/hardware  (community submission — auto-approve=false)
func (h *HardwareHandler) Create(c *gin.Context) {
	var input services.CreateHardwareInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request body"})
		return
	}
	comp, err := h.svc.Create(input, nil, false)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to submit component"})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"data": comp})
}

// POST /api/admin/hardware  (admin — auto-approve=true)
func (h *HardwareHandler) AdminCreate(c *gin.Context) {
	var input services.CreateHardwareInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request body"})
		return
	}
	comp, err := h.svc.Create(input, nil, true)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create component"})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"data": comp})
}

// PUT /api/admin/hardware/:id
func (h *HardwareHandler) AdminUpdate(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid ID"})
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
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid ID"})
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
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid ID"})
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
	minPrice, _ := strconv.ParseFloat(c.Query("min_price"), 64)
	maxPrice, _ := strconv.ParseFloat(c.Query("max_price"), 64)
	limit, _ := strconv.Atoi(c.Query("limit"))
	offset, _ := strconv.Atoi(c.Query("offset"))

	f := services.HardwareFilter{
		Category: c.Query("category"),
		Brand:    c.Query("brand"),
		Search:   c.Query("search"),
		MinPrice: minPrice,
		MaxPrice: maxPrice,
		Limit:    limit,
		Offset:   offset,
	}

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

// POST /api/hardware/:id/like
func (h *HardwareHandler) Like(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid ID"})
		return
	}
	if err := h.svc.Like(id); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to like"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "Liked"})
}

// PATCH /api/admin/hardware/:id/buy-urls
func (h *HardwareHandler) AdminUpdateBuyURLs(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid ID"})
		return
	}

	var body struct {
		BuyURLs      json.RawMessage `json:"buy_urls"`
		AffiliateTag string          `json:"affiliate_tag"`
	}

	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request body"})
		return
	}

	if body.BuyURLs == nil {
		body.BuyURLs = json.RawMessage("[]")
	}

	err = h.svc.UpdateBuyURLs(id, body.BuyURLs, body.AffiliateTag)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update BuyURLs"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "Updated"})
}
