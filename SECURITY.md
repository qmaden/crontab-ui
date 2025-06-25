# Security Guide for Crontab UI

## Security Enhancements

This version of crontab-ui includes several security improvements to protect your system:

### 1. Command Validation
- **Dangerous Command Blocking**: Commands containing potentially harmful operations are automatically rejected
- **Pattern Detection**: Blocks commands like `rm -rf /`, `format`, `dd of=/dev/`, etc.
- **Client & Server Validation**: Double validation on both frontend and backend

### 2. Authentication
- **Required by Default**: Authentication is now required by default
- **Default Credentials**: If not configured, uses `admin/changeme` (CHANGE IMMEDIATELY!)
- **Environment Variables**: Set `BASIC_AUTH_USER` and `BASIC_AUTH_PWD`

### 3. Rate Limiting
- **General Requests**: 100 requests per 15 minutes per IP
- **Sensitive Operations**: 20 requests per 15 minutes per IP for dangerous operations

### 4. Security Headers
- **Helmet.js**: Implements security headers (CSP, XSS protection, etc.)
- **Content Security Policy**: Restricts resource loading
- **XSS Protection**: Input sanitization and output encoding

### 5. Input Validation
- **Server-side Validation**: All inputs validated on the server
- **XSS Prevention**: All user inputs sanitized
- **File Upload Restrictions**: Only .db files allowed for import

## Blocked Command Patterns

The following command patterns are blocked for security:

- `rm` with root paths (`rm -rf /`)
- `mv` to root directories
- `cp` to root directories
- Dangerous permissions (`chmod 777/666`)
- Root ownership changes (`chown root`)
- User switching (`su`, `sudo`)
- Download and execute (`wget/curl | sh`)
- Reverse shells (`nc -e`)
- Code execution (`eval()`, `exec()`)
- System file redirection (`> /etc/`)
- Destructive operations (`format`, `mkfs`, `fdisk`, `dd of=/dev/`)
- System control (`reboot`, `shutdown`, `halt`, `poweroff`)

## Setup Instructions

### 1. Install Dependencies
```bash
npm install
```

### 2. Set Authentication (REQUIRED)
```bash
export BASIC_AUTH_USER="your_username"
export BASIC_AUTH_PWD="your_secure_password"
```

### 3. Optional: SSL Configuration
```bash
export SSL_KEY="/path/to/your/private.key"
export SSL_CERT="/path/to/your/certificate.crt"
```

### 4. Optional: Custom Database Path
```bash
export CRON_DB_PATH="/path/to/your/database/folder"
```

### 5. Start the Application
```bash
npm start
```

## Environment Variables

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `BASIC_AUTH_USER` | Username for authentication | `admin` | Yes* |
| `BASIC_AUTH_PWD` | Password for authentication | `changeme` | Yes* |
| `SSL_KEY` | Path to SSL private key | - | No |
| `SSL_CERT` | Path to SSL certificate | - | No |
| `CRON_DB_PATH` | Database directory path | `./crontabs` | No |
| `PORT` | Application port | `8000` | No |
| `HOST` | Application host | `127.0.0.1` | No |
| `NODE_ENV` | Environment mode | `development` | No |

*Required for security, has dangerous defaults if not set

## Security Best Practices

1. **Always set strong authentication credentials**
2. **Use HTTPS in production** (set SSL_KEY and SSL_CERT)
3. **Run with minimal privileges** (don't run as root unless necessary)
4. **Regularly backup your crontab database**
5. **Monitor logs for suspicious activity**
6. **Keep dependencies updated**
7. **Review all cron jobs before deploying**

## Security Warnings

- **Never run as root** unless absolutely necessary
- **Always use strong passwords** for authentication
- **Regularly audit your cron jobs** for unauthorized changes
- **Monitor system logs** for suspicious activity
- **Keep the application updated** with security patches

## Reporting Security Issues

If you discover a security vulnerability, please report it privately to the maintainers.
