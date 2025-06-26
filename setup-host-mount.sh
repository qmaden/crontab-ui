#!/bin/bash

# setup-host-mount.sh - Setup host filesystem mounting for Crontab-UI

set -e

echo "🔧 Setting up Crontab-UI host filesystem mounting..."

# Create data directories
echo "📁 Creating data directories..."
mkdir -p ./data/crontabs/logs
mkdir -p ./data/logs

# Set appropriate permissions
echo "🔒 Setting permissions..."
chmod 755 ./data/crontabs
chmod 755 ./data/logs
chmod 755 ./data/crontabs/logs

# Create .env file if it doesn't exist
if [ ! -f .env ]; then
    echo "⚙️  Creating .env file..."
    cat > .env << 'EOF'
# Crontab-UI Configuration
BASIC_AUTH_USER=admin
BASIC_AUTH_PWD=changeme
NODE_ENV=production
HOST=0.0.0.0
PORT=8000
CRON_IN_DOCKER=true

# Database Configuration
CRON_DB_PATH=/crontab-ui/crontabs
EOF
    echo "✅ Created .env file with default settings"
else
    echo "ℹ️  .env file already exists"
fi

# Create initial database if it doesn't exist
if [ ! -f ./data/crontabs/crontab.db ]; then
    echo "🗄️  Creating initial database structure..."
    touch ./data/crontabs/crontab.db
    echo "✅ Created empty database file"
fi

# Create docker-compose override for development
cat > docker-compose.override.yml << 'EOF'
version: '3.8'

services:
  crontab-ui:
    volumes:
      # Override with host filesystem mounts
      - ./data/crontabs:/crontab-ui/crontabs
      - ./data/logs:/crontab-ui/logs
      # Optional: Mount host system crontabs (read-only)
      # - /var/spool/cron/crontabs:/host-crontabs:ro
    environment:
      # Load from .env file
      - BASIC_AUTH_USER=${BASIC_AUTH_USER}
      - BASIC_AUTH_PWD=${BASIC_AUTH_PWD}
EOF

echo "✅ Host filesystem setup complete!"
echo ""
echo "📋 Next steps:"
echo "1. Review and edit .env file if needed"
echo "2. Run: docker-compose up -d"
echo "3. Access Crontab-UI at http://localhost:8000"
echo ""
echo "📁 Data will be stored in:"
echo "   - ./data/crontabs/ (crontab database and job logs)"
echo "   - ./data/logs/ (application logs)"
echo ""
echo "🔄 To use Docker volumes instead, remove docker-compose.override.yml"
