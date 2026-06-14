# syntax=docker/dockerfile:1

FROM golang:1.24-alpine AS backend-builder
WORKDIR /src/backend
COPY backend/go.mod backend/go.sum ./
RUN go mod download
COPY backend/ ./
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o /out/backend ./cmd/server

FROM golang:1.24-alpine AS ipam-builder
WORKDIR /src/hlbipam
COPY hlbipam/go.mod ./
RUN go mod download
COPY hlbipam/ ./
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o /out/hlbipam ./cmd/server

FROM node:24-alpine AS frontend-builder
WORKDIR /src/frontend
COPY frontend/package*.json ./
RUN npm install --legacy-peer-deps
ARG VITE_API_URL=
ARG VITE_GOOGLE_CLIENT_ID=
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_GOOGLE_CLIENT_ID=$VITE_GOOGLE_CLIENT_ID
COPY frontend/ ./
RUN npm run build

FROM alpine:3.19
RUN apk add --no-cache ca-certificates nginx tini tzdata

WORKDIR /app
COPY --from=backend-builder /out/backend /app/backend
COPY --from=ipam-builder /out/hlbipam /app/hlbipam
COPY --from=frontend-builder /src/frontend/dist /usr/share/nginx/html
COPY deploy/single/nginx.conf /etc/nginx/http.d/default.conf
COPY deploy/single/entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh && mkdir -p /run/nginx

ENV SERVER_PORT=8080
ENV PORT=8081
ENV IPAM_URL=http://127.0.0.1:8081

EXPOSE 80
ENTRYPOINT ["/sbin/tini", "--", "/app/entrypoint.sh"]
