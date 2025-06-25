# Changelog

## Version 0.4.0 - Security Enhanced Release

### 🔒 Security Enhancements

#### Authentication & Authorization
- **BREAKING**: Authentication is now required by default
- Default credentials: `admin/changeme` (MUST be changed!)
- Environment variables: `BASIC_AUTH_USER` and `BASIC_AUTH_PWD`
- Enhanced authentication realm and challenge response

#### Command Validation & Filtering
- **NEW**: Server-side dangerous command detection and blocking
- **NEW**: Client-side command validation with user warnings
- Blocks destructive commands: `rm -rf /`, `format`, `dd of=/dev/`, etc.
- Prevents system directory modifications
- Blocks privilege escalation attempts (`su`, `sudo`)
- Prevents reverse shell creation (`nc -e`, download & execute)
- Input sanitization using XSS protection

#### Rate Limiting & DoS Protection
- General rate limiting: 100 requests per 15 minutes per IP
- Strict rate limiting: 20 requests per 15 minutes for sensitive operations
- File size limits for log viewing (10MB max)
- Protection against brute force attacks

#### Security Headers & CSP
- **NEW**: Helmet.js integration for security headers
- Content Security Policy (CSP) implementation
- XSS protection headers
- Frame options and content type sniffing protection

#### Database Security
- **FIXED**: Replaced vulnerable `nedb` with secure `@seald-io/nedb`
- Input validation for database operations
- Path traversal protection
- File upload restrictions (only .db files)

### 🚀 Feature Enhancements

#### UI Improvements
- **NEW**: Added missing "Reboot" button for @reboot schedule
- Enhanced schedule display with macro descriptions
- Security notices and warnings in UI
- Better error messages and user feedback
- Command input field with security warnings

#### Error Handling & Logging
- Enhanced error handling with proper HTTP status codes
- Improved logging for security events
- Better validation error messages
- Production-safe error responses (no information leakage)

#### API Improvements
- **BREAKING**: All API responses now return JSON instead of plain text
- Proper HTTP status codes for all operations
- Enhanced validation for all endpoints
- Better error propagation to frontend

### 🛠️ Technical Improvements

#### Dependencies
- Updated all dependencies to latest secure versions
- Removed vulnerable packages
- Added security-focused packages (helmet, express-rate-limit, validator, xss)
- Upgraded Node.js requirement to >=18.0.0

#### Code Quality
- Enhanced input validation throughout the application
- Better error handling and try-catch blocks
- Improved code organization and security patterns
- Added JSDoc comments for security functions

### 📚 Documentation

#### New Documentation
- **NEW**: SECURITY.md with comprehensive security guide
- Updated README.md with security setup instructions
- Environment variable documentation
- Security best practices guide

#### Setup Instructions
- Clear authentication setup requirements
- SSL/HTTPS configuration guide
- Security warnings and notices
- Environment variable reference

### 🔧 Configuration Changes

#### Environment Variables
- `BASIC_AUTH_USER` - Username (required for security)
- `BASIC_AUTH_PWD` - Password (required for security)
- `SSL_KEY` - SSL private key path (optional)
- `SSL_CERT` - SSL certificate path (optional)
- `NODE_ENV` - Environment mode (affects error verbosity)

#### Backwards Compatibility
- **BREAKING**: Authentication now required (was optional)
- **BREAKING**: API responses changed from text to JSON
- **BREAKING**: Some dangerous commands will be rejected
- Database format remains compatible
- Environment variables mostly compatible

### 🚨 Migration Notes

#### Upgrading from 0.3.x
1. **REQUIRED**: Set authentication credentials before starting
2. Update any scripts expecting text responses to handle JSON
3. Review existing cron jobs for any blocked commands
4. Update Node.js to version 18+ if needed
5. Test all functionality in a non-production environment first

#### Security Checklist
- [ ] Set strong authentication credentials
- [ ] Enable HTTPS for production use
- [ ] Review all existing cron jobs
- [ ] Update any integration scripts
- [ ] Test backup/restore functionality
- [ ] Monitor logs for security events

### 🐛 Bug Fixes
- Fixed cron expression parsing for @reboot and other macros
- Improved error handling in backup/restore operations
- Fixed path traversal vulnerabilities in file operations
- Better handling of malformed cron expressions
- Fixed potential XSS vulnerabilities in job names and commands

### 🔮 Future Enhancements
- Multi-user support with role-based access
- Audit logging and activity monitoring
- Integration with external authentication systems
- Advanced command whitelisting/blacklisting
- Real-time job monitoring and alerts
