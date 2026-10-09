package services

import "testing"

func TestNormalizeHardwareCategory_CPU(t *testing.T) {
	for _, category := range []string{"cpu", "CPUs"} {
		if got := NormalizeHardwareCategory(category); got != "cpu" {
			t.Errorf("NormalizeHardwareCategory(%q) = %q, want cpu", category, got)
		}
		if got := HardwareCategoryToNodeType(category); got != "cpu" {
			t.Errorf("HardwareCategoryToNodeType(%q) = %q, want cpu", category, got)
		}
	}
}
