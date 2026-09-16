package core

import "github.com/Butterski/hlbipam/internal/models"

func Validate(req models.AllocateRequest) models.ValidateResponse {
	allocation := Allocate(req)
	return models.ValidateResponse{
		Valid:    len(allocation.Conflicts) == 0,
		Errors:   append([]models.Issue(nil), allocation.Conflicts...),
		Warnings: append([]models.Issue(nil), allocation.Warnings...),
	}
}
