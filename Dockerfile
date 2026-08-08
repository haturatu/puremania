# syntax=docker/dockerfile:1

FROM golang:1.25-bookworm AS builder

WORKDIR /src

COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/puremania .

FROM node:26-bookworm-slim AS frontend

WORKDIR /src

COPY package.json build.js ./
COPY static ./static
COPY index.html.local ./index.html.local

RUN npm install \
    && npm run build

FROM mwader/static-ffmpeg:8.1.2 AS static-ffmpeg

# P3TERX supplies a statically linked aria2c for supported Linux platforms.
FROM p3terx/aria2-pro:test AS static-aria2

FROM debian:bookworm-slim AS runtime

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        media-types \
    && rm -rf /var/lib/apt/lists/*

RUN useradd --system --uid 1000 --home-dir /home/puremania --create-home --shell /usr/bin/nologin puremania \
    && mkdir -p /app /data \
    && chown -R puremania:puremania /app /data

WORKDIR /app

COPY --from=builder /out/puremania /app/puremania
COPY --from=frontend /src/static /app/static
COPY --from=static-ffmpeg /ffmpeg /usr/local/bin/ffmpeg
COPY --from=static-aria2 /usr/local/bin/aria2c /usr/local/bin/aria2c

USER puremania

EXPOSE 8844

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD ["/app/puremania", "healthcheck"]

ENTRYPOINT ["/app/puremania"]
