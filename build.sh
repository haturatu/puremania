#!/bin/bash

set -eo pipefail

PROJECT_NAME="puremania"

echo "Building Pure Mania..."

# 依存関係の整理
echo "Downloading Go dependencies..."
go mod tidy

# 静的解析
echo "Running go vet..."
go vet ./...

# ビルド
echo "Building backend..."
CGO_ENABLED=0 GOOS=linux go build -o ${PROJECT_NAME} .

chmod +x ${PROJECT_NAME}

echo "Build completed successfully!"
echo ""
echo "Usage:"
echo "  1. Set up configuration in .env"
echo "  2. Create storage directories"
echo "  3. Run the application:"
echo "     ./${PROJECT_NAME}"
echo "  4. Open browser: http://localhost:8844"

