#!/bin/bash

# Crontab-UI Docker Build and Management Script
# This script helps build, tag, and manage Docker images for crontab-ui

set -e  # Exit on any error

# Configuration
IMAGE_NAME="crontab-ui"
REGISTRY="ghcr.io"  # GitHub Container Registry
USERNAME="${GITHUB_USERNAME:-yourusername}"  # Replace with your GitHub username
VERSION="$(grep -o '"version": "[^"]*"' package.json | cut -d'"' -f4)"
LATEST_TAG="latest"
PLATFORMS="linux/amd64,linux/arm64"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

print_header() {
    echo -e "${BLUE}=== $1 ===${NC}"
}

# Function to check if Docker is running
check_docker() {
    if ! docker info >/dev/null 2>&1; then
        print_error "Docker is not running. Please start Docker and try again."
        exit 1
    fi
}

# Function to check if buildx is available
check_buildx() {
    if ! docker buildx version >/dev/null 2>&1; then
        print_warning "Docker buildx not available. Multi-platform builds will not work."
        return 1
    fi
    return 0
}

# Function to build the image
build_image() {
    local tag_suffix="$1"
    local dockerfile="${2:-Dockerfile}"
    
    print_header "Building Docker Image"
    
    if check_buildx && [ "$MULTI_PLATFORM" = "true" ]; then
        print_status "Building multi-platform image..."
        docker buildx build \
            --platform "$PLATFORMS" \
            --tag "$IMAGE_NAME:$tag_suffix" \
            --tag "$REGISTRY/$USERNAME/$IMAGE_NAME:$tag_suffix" \
            --file "$dockerfile" \
            --push \
            .
    else
        print_status "Building single-platform image..."
        docker build \
            --tag "$IMAGE_NAME:$tag_suffix" \
            --tag "$REGISTRY/$USERNAME/$IMAGE_NAME:$tag_suffix" \
            --file "$dockerfile" \
            .
    fi
    
    print_status "Build completed successfully!"
}

# Function to run tests on the built image
test_image() {
    local tag="$1"
    
    print_header "Testing Docker Image"
    
    print_status "Starting container for testing..."
    CONTAINER_ID=$(docker run -d -p 8001:8000 "$IMAGE_NAME:$tag")
    
    # Wait for container to start
    sleep 5
    
    # Test health endpoint
    if curl -f http://localhost:8001/health >/dev/null 2>&1; then
        print_status "Health check passed!"
    else
        print_error "Health check failed!"
        docker logs "$CONTAINER_ID"
        docker stop "$CONTAINER_ID"
        docker rm "$CONTAINER_ID"
        exit 1
    fi
    
    # Cleanup
    docker stop "$CONTAINER_ID"
    docker rm "$CONTAINER_ID"
    
    print_status "All tests passed!"
}

# Function to push to registry
push_image() {
    local tag="$1"
    
    print_header "Pushing to Registry"
    
    if [ -z "$GITHUB_TOKEN" ]; then
        print_warning "GITHUB_TOKEN not set. Please login to GitHub Container Registry:"
        echo "echo \$GITHUB_TOKEN | docker login ghcr.io -u $USERNAME --password-stdin"
        return 1
    fi
    
    print_status "Pushing $REGISTRY/$USERNAME/$IMAGE_NAME:$tag..."
    docker push "$REGISTRY/$USERNAME/$IMAGE_NAME:$tag"
    
    print_status "Push completed successfully!"
}

# Function to clean up old images
cleanup() {
    print_header "Cleaning Up"
    
    print_status "Removing dangling images..."
    docker image prune -f
    
    print_status "Cleanup completed!"
}

# Function to show usage
usage() {
    cat << EOF
Usage: $0 [COMMAND] [OPTIONS]

Commands:
    build           Build the Docker image
    test            Test the built image
    push            Push image to registry
    release         Build, test, and push (full release)
    clean           Clean up dangling images
    dev             Build and run for development

Options:
    --multi-platform    Build for multiple platforms (requires buildx)
    --no-test          Skip testing phase
    --tag TAG          Use custom tag (default: version from package.json)
    --dockerfile FILE  Use custom Dockerfile (default: Dockerfile)
    --help             Show this help message

Environment Variables:
    GITHUB_USERNAME    Your GitHub username (required for push)
    GITHUB_TOKEN       GitHub token for authentication (required for push)

Examples:
    $0 build                    # Build image with version tag
    $0 build --tag latest       # Build with latest tag
    $0 release --multi-platform # Full multi-platform release
    $0 dev                      # Development build and run
    
EOF
}

# Parse command line arguments
COMMAND=""
CUSTOM_TAG=""
DOCKERFILE="Dockerfile"
SKIP_TEST=false
MULTI_PLATFORM=false

while [[ $# -gt 0 ]]; do
    case $1 in
        build|test|push|release|clean|dev)
            COMMAND="$1"
            shift
            ;;
        --multi-platform)
            MULTI_PLATFORM=true
            shift
            ;;
        --no-test)
            SKIP_TEST=true
            shift
            ;;
        --tag)
            CUSTOM_TAG="$2"
            shift 2
            ;;
        --dockerfile)
            DOCKERFILE="$2"
            shift 2
            ;;
        --help)
            usage
            exit 0
            ;;
        *)
            print_error "Unknown option: $1"
            usage
            exit 1
            ;;
    esac
done

# Set tag
TAG="${CUSTOM_TAG:-$VERSION}"

# Main execution
main() {
    check_docker
    
    case "$COMMAND" in
        build)
            build_image "$TAG" "$DOCKERFILE"
            ;;
        test)
            test_image "$TAG"
            ;;
        push)
            push_image "$TAG"
            if [ "$TAG" != "$LATEST_TAG" ]; then
                docker tag "$IMAGE_NAME:$TAG" "$IMAGE_NAME:$LATEST_TAG"
                docker tag "$IMAGE_NAME:$TAG" "$REGISTRY/$USERNAME/$IMAGE_NAME:$LATEST_TAG"
                push_image "$LATEST_TAG"
            fi
            ;;
        release)
            build_image "$TAG" "$DOCKERFILE"
            if [ "$SKIP_TEST" = false ]; then
                test_image "$TAG"
            fi
            push_image "$TAG"
            if [ "$TAG" != "$LATEST_TAG" ]; then
                docker tag "$IMAGE_NAME:$TAG" "$IMAGE_NAME:$LATEST_TAG"
                docker tag "$IMAGE_NAME:$TAG" "$REGISTRY/$USERNAME/$IMAGE_NAME:$LATEST_TAG"
                push_image "$LATEST_TAG"
            fi
            ;;
        clean)
            cleanup
            ;;
        dev)
            build_image "dev" "$DOCKERFILE"
            print_status "Starting development container..."
            docker run -it --rm -p 8000:8000 -v "$(pwd):/crontab-ui" "$IMAGE_NAME:dev"
            ;;
        "")
            print_error "No command specified"
            usage
            exit 1
            ;;
        *)
            print_error "Unknown command: $COMMAND"
            usage
            exit 1
            ;;
    esac
}

main
