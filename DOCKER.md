# Docker Guide for Crontab-UI

This guide explains how to build, run, and deploy the Crontab-UI application using Docker.

## Quick Start

### Using Docker Compose (Recommended)

```bash
# Start the application
docker-compose up -d

# View logs
docker-compose logs -f

# Stop the application
docker-compose down
```

### Using Docker directly

```bash
# Build the image
docker build -t crontab-ui .

# Run the container
docker run -d -p 8000:8000 --name crontab-ui crontab-ui
```

## Build Scripts

### Automated Build Script

Use the `docker-build.sh` script for advanced build operations:

```bash
# Make script executable
chmod +x docker-build.sh

# Build image
./docker-build.sh build

# Build and test
./docker-build.sh build --tag latest

# Full release (build, test, push)
./docker-build.sh release

# Multi-platform build
./docker-build.sh build --multi-platform

# Development build
./docker-build.sh dev
```

### Using Makefile

```bash
# Show available commands
make help

# Build Docker image
make build

# Run tests
make test

# Start development environment
make dev-up

# Full release
make release
```

## Docker Images

### Production Image (Dockerfile)

- **Base**: Alpine Linux 3.19
- **Node.js**: 20-alpine (multi-stage build)
- **Features**: 
  - Multi-stage build for smaller image size
  - Non-root user for security
  - Health checks
  - Supervisor for process management

### Development Image (Dockerfile.dev)

- **Base**: Node.js 20-alpine
- **Features**:
  - Hot reloading with nodemon
  - Development dependencies included
  - Debugger port exposed (9229)
  - Volume mounting for live code updates

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `NODE_ENV` | `production` | Environment mode |
| `HOST` | `0.0.0.0` | Host to bind to |
| `PORT` | `8000` | Port to listen on |
| `CRON_IN_DOCKER` | `true` | Enable Docker-specific cron handling |
| `CRON_PATH` | `/etc/crontabs` | Path to cron files |

## Docker Compose Configurations

### Production (docker-compose.yml)

```yaml
# Features:
- Health checks
- Persistent volumes for data and logs
- Restart policies
- Optional nginx reverse proxy
- Network isolation
```

### Development (docker-compose.dev.yml)

```yaml
# Features:
- Live code reloading
- Development dependencies
- Debug port exposure
- Volume mounting for development
```

## Deployment Options

### 1. Local Development

```bash
# Start development environment
make dev-up

# Or using docker-compose directly
docker-compose -f docker-compose.dev.yml up
```

### 2. Production Deployment

```bash
# Using docker-compose
docker-compose up -d

# Using Docker directly
docker run -d \
  -p 8000:8000 \
  -v crontab_data:/crontab-ui/crontabs \
  -v crontab_logs:/crontab-ui/logs \
  --restart unless-stopped \
  --name crontab-ui \
  crontab-ui:latest
```

### 3. With Reverse Proxy

```bash
# Start with nginx proxy
docker-compose --profile with-proxy up -d
```

## Registry Publishing

### GitHub Container Registry

```bash
# Login to GHCR
echo $GITHUB_TOKEN | docker login ghcr.io -u USERNAME --password-stdin

# Build and push
./docker-build.sh release --multi-platform

# Or using make
make push
```

### Docker Hub

```bash
# Login to Docker Hub
docker login

# Tag and push
docker tag crontab-ui:latest username/crontab-ui:latest
docker push username/crontab-ui:latest
```

## Health Checks

The Docker images include built-in health checks:

```bash
# Check container health
docker inspect --format='{{.State.Health.Status}}' crontab-ui

# View health check logs
docker inspect --format='{{range .State.Health.Log}}{{.Output}}{{end}}' crontab-ui
```

## Security Features

- **Non-root user**: Application runs as `nodejs` user
- **Minimal base image**: Alpine Linux for smaller attack surface
- **Security scanning**: Trivy scanning in CI/CD
- **Read-only filesystem**: Where possible
- **Capability dropping**: Minimal required capabilities

## Troubleshooting

### Common Issues

1. **Permission denied errors**
   ```bash
   # Fix file permissions
   docker exec -it crontab-ui chown -R nodejs:nodejs /crontab-ui
   ```

2. **Health check failures**
   ```bash
   # Check application logs
   docker logs crontab-ui
   
   # Test health endpoint manually
   curl http://localhost:8000/health
   ```

3. **Cron jobs not running**
   ```bash
   # Check cron daemon status
   docker exec -it crontab-ui ps aux | grep crond
   
   # View cron logs
   docker exec -it crontab-ui tail -f /var/log/supervisor/crontab-stdout.log
   ```

### Debugging

```bash
# Open shell in running container
make shell

# Or using docker directly
docker exec -it crontab-ui /bin/sh

# View supervisor logs
docker exec -it crontab-ui tail -f /var/log/supervisor/supervisord.log
```

## CI/CD Integration

The repository includes GitHub Actions workflow (`.github/workflows/docker.yml`) that:

- Builds multi-platform images
- Runs security scans
- Publishes to GitHub Container Registry
- Tests on pull requests

### Manual CI/CD Setup

```bash
# Set required secrets in GitHub:
# - GITHUB_TOKEN (automatic)
# - Additional registry tokens if needed

# Workflow triggers on:
# - Push to main/develop branches
# - Version tags (v*)
# - Pull requests
```

## Performance Optimization

### Build Optimization

- Multi-stage builds reduce final image size
- `.dockerignore` excludes unnecessary files
- Layer caching improves build times
- BuildKit features for advanced caching

### Runtime Optimization

- Health checks for proper orchestration
- Supervisor for process management
- Volume mounting for persistent data
- Memory and CPU limits in production

## Advanced Usage

### Custom Configuration

```bash
# Mount custom configuration
docker run -d \
  -p 8000:8000 \
  -v /host/config:/crontab-ui/config \
  -v /host/crontabs:/crontab-ui/crontabs \
  crontab-ui:latest
```

### Backup and Restore

```bash
# Backup crontab data
docker cp crontab-ui:/crontab-ui/crontabs ./backup/

# Restore crontab data
docker cp ./backup/crontabs crontab-ui:/crontab-ui/
```

### Monitoring

```bash
# Resource usage
docker stats crontab-ui

# Process list
docker exec -it crontab-ui ps aux

# Network connections
docker exec -it crontab-ui netstat -tulpn
```
