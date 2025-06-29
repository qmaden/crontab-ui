# Multi-stage build for optimized production image
FROM node:20-alpine AS builder

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production && npm cache clean --force

# Production stage
FROM alpine:3.19

# Install runtime dependencies
RUN apk --no-cache add \
    nodejs \
    npm \
    supervisor \
    dcron \
    tzdata \
    curl \
    && rm -rf /var/cache/apk/*

# Create application directory
WORKDIR /crontab-ui

# Environment variables
ENV CRON_PATH=/etc/crontabs
ENV HOST=0.0.0.0
ENV PORT=8000
ENV CRON_IN_DOCKER=true
ENV NODE_ENV=production

# Create necessary directories and files with proper permissions
RUN mkdir -p $CRON_PATH /crontab-ui/logs \
    && touch $CRON_PATH/root \
    && chmod +x $CRON_PATH/root

# Copy supervisor configuration
COPY supervisord.conf /etc/supervisord.conf

# Copy node_modules from builder stage
COPY --from=builder /app/node_modules ./node_modules

# Copy application code
COPY . .

# Create non-root user for security and set proper permissions
RUN addgroup -g 1001 -S nodejs \
    && adduser -S nodejs -u 1001 \
    && chown -R nodejs:nodejs /crontab-ui \
    && chmod +x /crontab-ui/start-secure.sh 2>/dev/null || true

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8000/health || exit 1

# Labels for better container management
LABEL maintainer="crontab-ui"
LABEL description="Modern Crontab-UI docker image"
LABEL version="0.5.0"
LABEL org.opencontainers.image.source="https://github.com/yourusername/crontab-ui"

# Expose port
EXPOSE 8000

# Start supervisor as root (it will drop privileges for individual programs)
CMD ["supervisord", "-c", "/etc/supervisord.conf"]
