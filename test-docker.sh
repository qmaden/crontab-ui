#!/bin/bash

# Quick Docker test script for troubleshooting
set -e

echo "🐳 Building Docker image..."
docker build -t crontab-ui:test .

echo "🚀 Starting container for testing..."
CONTAINER_ID=$(docker run -d -p 8001:8000 --name crontab-ui-test crontab-ui:test)

echo "📋 Container ID: $CONTAINER_ID"

# Wait a moment for container to start
sleep 5

echo "📊 Checking container status..."
docker ps -f name=crontab-ui-test

echo "📝 Container logs:"
docker logs crontab-ui-test

echo "🔍 Testing health endpoint..."
if curl -f http://localhost:8001/health 2>/dev/null; then
    echo "✅ Health check passed!"
else
    echo "❌ Health check failed!"
    echo "📝 Recent logs:"
    docker logs --tail 20 crontab-ui-test
fi

echo "🧹 Cleaning up..."
docker stop crontab-ui-test
docker rm crontab-ui-test

echo "✨ Test completed!"
