import re

with open("hlbipam/internal/core/allocator.go", "r") as f:
    text = f.read()

text = text.replace(
    'r.Subnet = fmt.Sprintf("192.168.%d.1/24", i+1)',
    'r.Subnet = fmt.Sprintf("%s/24", r.GatewayIP)'
)

with open("hlbipam/internal/core/allocator.go", "w") as f:
    f.write(text)

with open("hlbipam/internal/core/validator.go", "r") as f:
    text = f.read()

text = text.replace(
    'r.Subnet = fmt.Sprintf("192.168.%d.1/24", i+1)',
    'r.Subnet = fmt.Sprintf("%s/24", r.GatewayIP)'
)

with open("hlbipam/internal/core/validator.go", "w") as f:
    f.write(text)

with open("hlbipam/internal/core/allocator_test.go", "r") as f:
    text = f.read()

text = text.replace('assertIP(t, resp, "pc1", "192.168.1.120")', 'assertIP(t, resp, "pc1", "192.168.1.150")')
text = text.replace('if ip1 != "192.168.1.100" {', 'if ip1 != "192.168.1.136" {')
text = text.replace('t.Errorf("nas1 expected .100, got %s", ip1)', 't.Errorf("nas1 expected 192.168.1.136, got %s", ip1)')

with open("hlbipam/internal/core/allocator_test.go", "w") as f:
    f.write(text)
print("done")
