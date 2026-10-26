# Installation Guide

This comprehensive guide walks you through installing the Argos on various platforms and environments.

## System Requirements

### Minimum Requirements
- **Node.js**: 22.0.0 or higher
- **npm**: 10.0.0 or higher
- **Memory**: 256 MB RAM
- **Storage**: 100 MB available disk space
- **Network**: Internet access for package installation

### Recommended Requirements
- **Node.js**: 24.15.0 or higher (current LTS)
- **npm**: 11.0.0 or higher
- **Memory**: 512 MB RAM
- **Storage**: 500 MB available disk space
- **Database Access**: Network connectivity to your databases

### Supported Platforms
- **Windows**: 10, 11, Server 2019, Server 2022
- **macOS**: 10.15 (Catalina) or later
- **Linux**: Ubuntu 18.04+, CentOS 7+, Debian 9+, RHEL 7+

## Quick Installation

### Option 0: Register with Claude Code (Easiest)

Argos is registered with Claude Code's own CLI — there is no bespoke installer to run.

```bash
git clone https://github.com/AraneaDev/argos.git
cd Argos
npm install && npm run build
npm run setup   # writes config.ini

claude mcp add argos --scope user -- \
  node "$(pwd)/dist/cli.js" serve --config "$HOME/.config/argos/config.ini"
```

**Scopes:**
```bash
claude mcp add argos --scope user -- ...     # available in every project (default choice)
claude mcp add argos --scope project -- ...  # writes .mcp.json, shareable via git
claude mcp add argos -- ...                  # local to the current project only
```

**Managing the registration:**
```bash
claude mcp list          # confirm argos is connected
claude mcp get argos     # show the recorded command, args, and scope
claude mcp remove argos --scope user
```

> Paths passed to `claude mcp add` must be absolute — Claude Code spawns the server directly and does not expand `~` or resolve relative paths.

### Option 1: NPM Package

Not yet available. Argos is not published to the npm registry — the publish step
in the release workflow is deliberately dormant until the first public release —
so `npm install -g argos-mcp` will not resolve. Install from source.

### Option 2: From Source

```bash
# Clone repository
git clone https://github.com/AraneaDev/argos.git
cd Argos

# Install dependencies
npm install

# Build the project
npm run build

# Run setup
npm run setup
```

## Detailed Installation Steps

### Windows Installation

#### Prerequisites
1. **Install Node.js**
 - Download from [nodejs.org](https://nodejs.org/)
 - Choose an LTS version (24.x or newer)
 - Run installer with default options

2. **Verify Installation**
 ```cmd
 node --version
 npm --version
 ```

#### Install Argos
```cmd
git clone https://github.com/AraneaDev/argos.git C:\argos
cd C:\argos
npm install
npm run build
npm run setup
```

#### Windows-Specific Configuration
```ini
# Windows paths in config.ini
[database.local]
type=sqlite
file=C:\data\app.sqlite

# SSH key paths
ssh_private_key=C:\Users\username\.ssh\id_rsa
```

### macOS Installation

#### Prerequisites
1. **Install Node.js**
 ```bash
 # Using Homebrew (recommended)
 brew install node@24

 # Or download from nodejs.org
 ```

2. **Install Xcode Command Line Tools** (if building from source)
 ```bash
 xcode-select --install
 ```

#### Install Argos
```bash
git clone https://github.com/AraneaDev/argos.git
cd Argos
npm install
npm run build

# Optional: put argos on your PATH
npm link

npm run setup
```

#### macOS-Specific Notes
- Claude Code stores user-scope registrations in `~/.claude.json`
- Default SSH key location: `~/.ssh/id_rsa`

### Linux Installation

#### Ubuntu/Debian
```bash
# Update package index
sudo apt update

# Install Node.js 24.x
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install build tools (if building from source)
sudo apt-get install -y build-essential

# Install Argos from source
sudo mkdir -p /opt/argos
sudo chown $USER:$USER /opt/argos
git clone https://github.com/AraneaDev/argos.git /opt/argos
cd /opt/argos
npm install && npm run build
npm run setup
```

#### CentOS/RHEL/Rocky Linux
```bash
# Install Node.js 24.x
curl -fsSL https://rpm.nodesource.com/setup_24.x | sudo bash -
sudo dnf install -y nodejs

# Install development tools (if building from source)
sudo dnf groupinstall -y "Development Tools"

# Install Argos from source
sudo mkdir -p /opt/argos
sudo chown $USER:$USER /opt/argos
git clone https://github.com/AraneaDev/argos.git /opt/argos
cd /opt/argos
npm install && npm run build
npm run setup
```

## Installation Directories

### Installed From Source
```
Argos/
+-- dist/ # Compiled output; index.js and setup.js are executable
+-- config.ini # Your configuration, if you keep it here
+-- config.ini.template # Starting point for a manual configuration
+-- schemas/ # Schema cache, written at runtime
+-- argos.log # Log file, rotated to .log.1 on each start
```

The configuration does not have to live in the checkout. The convention is
`~/.config/argos/config.ini`, passed with `--config`.

## Configuration

### Initial Setup
After installation, run the setup wizard:

```bash
npm run setup
# or, after npm link:
argos setup
```

> **Tip:** `argos setup` only writes `config.ini`. Registering the server with Claude Code is a separate step — see [Option 0](#option-0-register-with-claude-code-easiest) above.

The setup wizard will guide you through:

1. **Database Configuration**
 - Database type selection
 - Connection parameters
 - Security settings

2. **Extension Settings**
 - Query limits and timeouts
 - Performance tuning

3. **Security Configuration**
 - Query complexity limits
 - SELECT-only mode settings

### Manual Configuration
If you prefer manual configuration, copy and edit the template:

```bash
# Copy configuration template
cp config.ini.template config.ini

# Edit configuration
nano config.ini # Linux/macOS
notepad config.ini # Windows
```

## Database Drivers

The server includes drivers for all supported databases:

### Included Database Drivers
- **PostgreSQL**: `pg` (node-postgres)
- **MySQL**: `mysql2`
- **SQLite**: `sqlite3`
- **SQL Server**: `mssql`
- **SSH Tunneling**: `ssh2`

### Verify Driver Installation
```bash
# Check if all drivers are available
node -e "
const drivers = ['pg', 'mysql2', 'sqlite3', 'mssql', 'ssh2'];
drivers.forEach(driver => {
 try {
 require(driver);
 console.log('', driver);
 } catch (e) {
 console.log('', driver);
 }
});
"
```

## Verify Installation

### Test Server Startup
```bash
# Start the server
npm start
# or if installed locally:
npm start

# Expected output:
# Argos running on stdio
# Server ready to register with Claude Code
```

### Test Database Connection
```bash
# Run connection test
npm run setup
# or if installed locally:
npm run setup

# Expected output for successful connection:
# Connection successful to database_name
# Schema captured: X tables, Y columns
```

### Test the Claude Code Integration
1. Register the server: `claude mcp add argos --scope user -- node /abs/path/dist/cli.js serve --config /abs/path/config.ini`
2. Confirm it connects: `claude mcp list`
3. Ask Claude: "List my available databases"
4. Expected: Claude shows your configured databases

## Docker Installation

### Using Pre-built Image
```bash
# Pull the official image
docker pull argos:latest

# Run with volume for configuration
docker run -it --rm \
 -v $(pwd)/config.ini:/app/config.ini \
 -v $(pwd)/logs:/app/logs \
 argos:latest
```

### Build from Source
```bash
# Clone repository
git clone https://github.com/AraneaDev/argos.git
cd Argos

# Build Docker image
docker build -t argos .

# Run container
docker run -it --rm \
 -v $(pwd)/config.ini:/app/config.ini \
 argos serve
```

### Docker Compose
```yaml
# docker-compose.yml
version: '3.8'

services:
 argos:
 image: argos:latest
 volumes:
 - ./config.ini:/app/config.ini:ro
 - ./logs:/app/logs
 environment:
 - NODE_ENV=production
 # Confines model-supplied SQLite paths to this directory. Worth setting in a
 # container, where the mount points are known.
 - SQL_MCP_SQLITE_BASE_DIR=/app/data
 restart: unless-stopped
```

## Enterprise Installation

### System Service Installation

#### Linux (systemd)
```bash
# Create service user
sudo useradd -r -s /bin/false argos

# Create service directory
sudo mkdir -p /opt/argos
sudo chown argos:argos /opt/argos

# Install service files
sudo cp argos.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable argos
sudo systemctl start argos
```

#### Windows Service
```cmd
# Install as Windows Service using node-windows
npm install -g node-windows

# Create service installer script
node install-service.js

# Start service
net start "Argos"
```

### Load Balancer Configuration
```nginx
# nginx configuration for multiple instances
upstream sql_mcp_servers {
 server 127.0.0.1:3001;
 server 127.0.0.1:3002;
 server 127.0.0.1:3003;
}

server {
 listen 80;
 server_name argos.company.com;

 location / {
 proxy_pass http://sql_mcp_servers;
 proxy_http_version 1.1;
 proxy_set_header Upgrade $http_upgrade;
 proxy_set_header Connection 'upgrade';
 proxy_cache_bypass $http_upgrade;
 }
}
```

## Development Installation

### Development Setup
```bash
# Clone repository
git clone https://github.com/AraneaDev/argos.git
cd Argos

# Install dependencies
npm install

# Install development tools
npm install -g typescript nodemon

# Build in watch mode
npm run dev

# Run tests
npm test
```

### Development Dependencies
```bash
# TypeScript and build tools
npm install -D typescript @types/node ts-node nodemon

# Testing framework
npm install -D jest @types/jest @swc/core @swc/jest supertest

# Linting and formatting
npm install -D eslint @eslint/js typescript-eslint eslint-plugin-jsdoc globals prettier

# Database testing tools
npm install -D @testcontainers/postgresql @testcontainers/mysql
```

## Updating

### Update NPM Package
```bash
# Check current version
argos version

# Update to latest version
npm update -g @araneadev/argos

# Verify update
argos version
```

> **Tip:** After updating, run `claude mcp get argos` to confirm the recorded path still points at the rebuilt `dist/cli.js`. Re-register with `claude mcp remove` + `claude mcp add` if the repository moved.

### Update from Source
```bash
# Pull latest changes
git pull origin main

# Update dependencies
npm install

# Rebuild
npm run build

# Test installation
npm test
```

### Migration Between Versions
```bash
# Backup current configuration
cp config.ini config.ini.backup

# Update installation
npm update -g @araneadev/argos

# Check for configuration changes
argos-migrate-config --check

# Apply configuration migration if needed
argos-migrate-config --apply
```

## Command Reference

| Command | Description |
|---------|-------------|
| `claude mcp add argos -- node <path>/dist/cli.js serve --config <path>/config.ini` | Register the server with Claude Code |
| `argos setup` | Interactive setup wizard for database configuration |
| `argos serve` | Start the MCP server |
| `npm start` | Start the MCP server (alias) |
| `sql_test_connection` (MCP tool) | Test database connections from Claude |

## Troubleshooting Installation

### Common Issues

#### Node.js Version Issues
```bash
# Check Node.js version
node --version

# If version is too old:
# - Windows: Download from nodejs.org
# - macOS: brew install node@24
# - Linux: Use NodeSource repository
```

#### Permission Issues (Linux/macOS)
```bash
# Fix npm global permissions
mkdir ~/.npm-global
npm config set prefix '~/.npm-global'
echo 'export PATH=~/.npm-global/bin:$PATH' >> ~/.profile
source ~/.profile
```

#### Build Failures
```bash
# Install build tools
# Windows: npm install -g windows-build-tools
# macOS: xcode-select --install
# Linux: sudo apt install build-essential

# Clear npm cache
npm cache clean --force

# Reinstall with verbose output
npm install -g argos --verbose
```

#### Database Driver Issues
```bash
# Rebuild native modules
npm rebuild

# For SQLite issues on Linux:
sudo apt-get install sqlite3 libsqlite3-dev

# For PostgreSQL issues:
sudo apt-get install libpq-dev
```

### Installation Verification Script
```bash
#!/bin/bash
# verify-installation.sh

echo " Verifying Argos Installation..."

# Check Node.js version
NODE_VERSION=$(node --version | cut -d'v' -f2)
echo "Node.js version: $NODE_VERSION"
if [ "$(printf '%s\n' "16.0.0" "$NODE_VERSION" | sort -V | head -n1)" = "16.0.0" ]; then
 echo " Node.js version is sufficient"
else
 echo " Node.js version is too old (need 16.0.0+)"
 exit 1
fi

# Check npm version
NPM_VERSION=$(npm --version)
echo "npm version: $NPM_VERSION"

# Check if argos is installed
if command -v argos &> /dev/null; then
 echo " argos command is available"
 argos version
else
 echo " argos command not found"
 exit 1
fi

# Check database drivers
echo "Checking database drivers..."
node -e "
const drivers = ['pg', 'mysql2', 'sqlite3', 'mssql', 'ssh2'];
drivers.forEach(driver => {
 try {
 require(driver);
 console.log(' ' + driver);
 } catch (e) {
 console.log(' ' + driver + ': ' + e.message);
 }
});
"

echo " Installation verification complete!"
```

## Next Steps

After successful installation:

1. **[Configure Your First Database](../tutorials/02-first-database.md)**
2. **[Register with Claude Code](../tutorials/03-claude-integration.md)**
3. **[Run Your First Query](../tutorials/04-basic-queries.md)**

For production deployments:
1. **[Security Hardening Guide](../operations/security-hardening.md)**
2. **[Deployment Guide](../operations/deployment-guide.md)**
3. **[Monitoring Setup](../operations/monitoring.md)**

---

**Need help?** Check the [troubleshooting guide](troubleshooting-guide.md) or ask in [GitHub Discussions](https://github.com/AraneaDev/argos/discussions).