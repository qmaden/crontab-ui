# Crontab-UI Makefile
# Modern Docker build and deployment automation

# Variables
VER := $(shell grep -o '"version": "[^"]*"' package.json | cut -d'"' -f4)
IMAGE_NAME := crontab-ui
REGISTRY := ghcr.io
USERNAME := $(shell git config user.name | tr '[:upper:]' '[:lower:]' | tr ' ' '-')
PLATFORMS := linux/amd64,linux/arm64

# Default target
.DEFAULT_GOAL := help

# Help target
.PHONY: help
help: ## Show this help message
	@echo "Crontab-UI Docker Management"
	@echo "Usage: make [target]"
	@echo ""
	@echo "Targets:"
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "  %-20s %s\n", $$1, $$2}'

# Docker targets
.PHONY: build
build: ## Build the Docker image
	@echo "Building $(IMAGE_NAME):$(VER)..."
	docker build -t $(IMAGE_NAME):$(VER) -t $(IMAGE_NAME):latest .

.PHONY: build-dev
build-dev: ## Build the development Docker image
	@echo "Building development image..."
	docker build -f Dockerfile.dev -t $(IMAGE_NAME):dev .

.PHONY: build-multi
build-multi: ## Build multi-platform Docker image
	@echo "Building multi-platform $(IMAGE_NAME):$(VER)..."
	docker buildx build --platform $(PLATFORMS) -t $(IMAGE_NAME):$(VER) -t $(IMAGE_NAME):latest --push .

.PHONY: test
test: ## Test the Docker image
	@echo "Testing $(IMAGE_NAME):$(VER)..."
	@./docker-build.sh test --tag $(VER)

.PHONY: run
run: ## Run the container locally
	@echo "Running $(IMAGE_NAME):$(VER)..."
	docker run --rm -it -p 8000:8000 $(IMAGE_NAME):$(VER)

.PHONY: run-dev
run-dev: ## Run development container with hot reload
	@echo "Running development container..."
	docker-compose -f docker-compose.dev.yml up --build

.PHONY: push
push: ## Push images to registry
	@echo "Pushing to $(REGISTRY)/$(USERNAME)/$(IMAGE_NAME)..."
	docker tag $(IMAGE_NAME):$(VER) $(REGISTRY)/$(USERNAME)/$(IMAGE_NAME):$(VER)
	docker tag $(IMAGE_NAME):latest $(REGISTRY)/$(USERNAME)/$(IMAGE_NAME):latest
	docker push $(REGISTRY)/$(USERNAME)/$(IMAGE_NAME):$(VER)
	docker push $(REGISTRY)/$(USERNAME)/$(IMAGE_NAME):latest

.PHONY: release
release: build test push ## Full release: build, test, and push
	@echo "Release $(VER) completed successfully!"

.PHONY: clean
clean: ## Clean up Docker images and containers
	@echo "Cleaning up..."
	docker image prune -f
	docker container prune -f

.PHONY: logs
logs: ## Show container logs
	docker logs crontab-ui

.PHONY: shell
shell: ## Open shell in running container
	docker exec -it crontab-ui /bin/sh

.PHONY: health
health: ## Check container health
	@curl -f http://localhost:8000/health && echo "✅ Health check passed" || echo "❌ Health check failed"

# Development targets
.PHONY: dev-up
dev-up: ## Start development environment
	docker-compose -f docker-compose.dev.yml up -d

.PHONY: dev-down
dev-down: ## Stop development environment
	docker-compose -f docker-compose.dev.yml down

.PHONY: dev-logs
dev-logs: ## Show development container logs
	docker-compose -f docker-compose.dev.yml logs -f

# Production targets
.PHONY: prod-up
prod-up: ## Start production environment
	docker-compose up -d

.PHONY: prod-down
prod-down: ## Stop production environment
	docker-compose down

.PHONY: prod-logs
prod-logs: ## Show production container logs
	docker-compose logs -f

# Utility targets
.PHONY: version
version: ## Show current version
	@echo "Current version: $(VER)"

.PHONY: update-version
update-version: ## Update version in package.json (VER=x.x.x make update-version)
ifndef VER
	$(error VER is not set. Usage: VER=x.x.x make update-version)
endif
	@sed -i '' "s/\"version\": \"[^\"]*\"/\"version\": \"$(VER)\"/" package.json
	@echo "Version updated to $(VER)"

.PHONY: npm-publish
npm-publish: ## Publish to npm registry
	npm publish

.PHONY: full-release
full-release: update-version build test push npm-publish ## Complete release with npm publish
	@echo "Full release $(VER) completed successfully!"
