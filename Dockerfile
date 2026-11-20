# syntax=docker/dockerfile:1

# 1. The dashboard. Built once, embedded into the Go binary.
FROM node:22-alpine AS web
RUN corepack enable
WORKDIR /src/web
COPY web/package.json web/pnpm-lock.yaml* web/pnpm-workspace.yaml* ./
RUN pnpm install --frozen-lockfile
COPY web/ ./
RUN pnpm build

# 2. The server: one static binary.
FROM golang:1.27-alpine AS server
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
COPY --from=web /src/web/dist ./web/dist
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /mails ./cmd/mails

# 3. Run: no shell, no package manager, not root.
FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=server /mails /mails
EXPOSE 3000
ENV ADDR=":3000"
USER nonroot:nonroot
ENTRYPOINT ["/mails"]
