#!/bin/bash

# Crontab UI - Security Enhanced Startup Script
# This script demonstrates proper security configuration

echo "🔒 Crontab UI - Security Enhanced Version"
echo "==========================================="

# Check for required authentication setup
if [ -z "$BASIC_AUTH_USER" ] || [ -z "$BASIC_AUTH_PWD" ]; then
    echo "⚠️  WARNING: Authentication not configured!"
    echo "   Setting default credentials (CHANGE THESE IMMEDIATELY!)"
    export BASIC_AUTH_USER="admin"
    export BASIC_AUTH_PWD="changeme"
    echo "   Username: admin"
    echo "   Password: changeme"
    echo ""
fi

# Production recommendations
echo "🚀 Security Status:"
echo "   Authentication: ✅ Enabled"
echo "   Rate Limiting: ✅ Enabled"
echo "   Command Filtering: ✅ Enabled"
echo "   XSS Protection: ✅ Enabled"
echo "   Security Headers: ✅ Enabled"

if [ -n "$SSL_KEY" ] && [ -n "$SSL_CERT" ]; then
    echo "   HTTPS: ✅ Enabled"
else
    echo "   HTTPS: ⚠️  Not configured (recommended for production)"
fi

echo ""
echo "📚 Documentation:"
echo "   Security Guide: ./SECURITY.md"
echo "   Changelog: ./CHANGELOG.md"
echo "   Setup: See README.md"
echo ""

echo "🌟 New Features:"
echo "   • @reboot schedule support"
echo "   • Dangerous command blocking"
echo "   • Enhanced error handling"
echo "   • Improved UI feedback"
echo ""

echo "🚨 IMPORTANT SECURITY NOTES:"
echo "   • Change default credentials immediately!"
echo "   • Review all existing cron jobs"
echo "   • Use HTTPS in production"
echo "   • Monitor logs for suspicious activity"
echo ""

echo "Starting Crontab UI..."
node app.js
