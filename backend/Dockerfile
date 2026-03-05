FROM golang:1.24-alpine AS builder

WORKDIR /app

COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o /server ./cmd/server

FROM alpine:3.19

RUN apk --no-cache add ca-certificates && \
    adduser -D -g '' appuser

WORKDIR /app
COPY --from=builder /server .

# Run as non-root user
USER appuser

EXPOSE 8080

CMD ["./server"]
