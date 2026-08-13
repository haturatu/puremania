#!/bin/bash

set -eo pipefail

PROJECT_NAME="puremania"
INDEX_FILE="static/index.html"

echo "Building Pure Mania..."

# Build the browser bundle before compiling the server when the local bundle is
# active. Remote mode loads modules from esm.sh and removes node_modules.
if grep -q 'https://esm\.sh/' "${INDEX_FILE}"; then
    echo "Remote frontend mode detected; skipping local frontend build."
else
    echo "Building frontend..."
    npm run build
fi

# 依存関係の整理
echo "Downloading Go dependencies..."
go mod tidy

# 静的解析
echo "Running go vet..."
go vet ./...

# ビルド
echo "Building backend..."
CGO_ENABLED=0 GOOS=linux go build -o ${PROJECT_NAME} ./cmd/puremania

chmod +x ${PROJECT_NAME}

echo "Build completed successfully!"
echo ""
echo "Usage:"
echo "  1. Set up configuration in .env"
echo "  2. Create storage directories"
echo "  3. Run the application:"
echo "     ./${PROJECT_NAME}"
echo "  4. Open browser: http://localhost:8844"
