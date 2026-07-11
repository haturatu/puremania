# syntax=docker/dockerfile:1

FROM golang:1.24-bookworm AS builder

WORKDIR /src

COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/puremania .

FROM debian:bookworm-slim AS runtime

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        aria2 \
        ca-certificates \
        curl \
        ffmpeg \
        lsof \
        procps \
    && rm -rf /var/lib/apt/lists/*

RUN useradd --system --uid 1000 --home-dir /home/puremania --create-home --shell /usr/sbin/nologin puremania \
    && mkdir -p /app /data \
    && chown -R puremania:puremania /app /data

WORKDIR /app

COPY --from=builder /out/puremania /app/puremania
COPY static /app/static

USER puremania

EXPOSE 8844

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -fsS http://127.0.0.1:${PORT}/api/health || exit 1

ENTRYPOINT ["/app/puremania"]
