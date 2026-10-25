# Argos Documentation Hub

Welcome to the comprehensive documentation for the Argos - a high-performance, secure TypeScript implementation for connecting Claude Code to your databases.

## Documentation Map

### Getting Started
- **[Quick Start Guide](guides/quick-start.md)** - Get up and running in 5 minutes
- **[Register with Claude Code](guides/installation-guide.md#option-0-register-with-claude-code-easiest)** - One-command setup with `claude mcp add`
- **[Installation Guide](guides/installation-guide.md)** - Detailed installation instructions 
- **[Configuration Guide](guides/configuration-guide.md)** - Complete configuration reference
- **[Troubleshooting](guides/troubleshooting-guide.md)** - Common issues and solutions

### Features
- **[Field Redaction](features/field-redaction.md)** - Automatic masking of sensitive data (emails, phones, SSNs) in query results

### Architecture & Design
- **[System Architecture](architecture/system-architecture.md)** - High-level system design
- **[Database Layer](architecture/database-layer.md)** - Database adapter pattern
- **[Security Architecture](architecture/security-architecture.md)** - Security model and implementation
- **[MCP Protocol](architecture/mcp-protocol.md)** - MCP protocol implementation
- **[Design Decisions](architecture/design-decisions.md)** - Architectural choices and trade-offs

### API Reference
- **[MCP Tools Reference](api/mcp-tools-reference.md)** - 12 MCP tools including database configuration management
- **[TypeScript API](api/typescript-api.md)** - TypeScript API reference 
- **[Error Codes](api/error-codes.md)** - Error codes and handling
- **[JSON Schemas](api/json-schemas.md)** - Request/response schemas

### Database Support
- **[PostgreSQL](databases/postgresql.md)** - PostgreSQL setup and features
- **[MySQL](databases/mysql.md)** - MySQL configuration and optimization
- **[SQLite](databases/sqlite.md)** - SQLite usage patterns
- **[SQL Server](databases/sql-server.md)** - SQL Server enterprise features
- **[SSH Tunneling](databases/ssh-tunneling.md)** - SSH tunnel configuration

### Step-by-Step Tutorials

#### Getting Started Series
1. **[Installation](tutorials/01-installation.md)** - Installing and first run
2. **[First Database](tutorials/02-first-database.md)** - Connecting your first database
3. **[Claude Integration](tutorials/03-claude-integration.md)** - Integrating with Claude Code
4. **[Basic Queries](tutorials/04-basic-queries.md)** - Running your first queries

#### Advanced Configuration Series
1. **[Multi-Database Setup](tutorials/advanced-01-multi-database.md)** - Managing multiple databases
2. **[SSH Tunnel Setup](tutorials/advanced-02-ssh-tunnels.md)** - Secure remote connections
3. **[Security Configuration](tutorials/advanced-03-security.md)** - Advanced security settings
4. **[Performance Optimization](tutorials/advanced-04-performance.md)** - Tuning for production

### Operations & Deployment
- **[Deployment Guide](operations/deployment-guide.md)** - Production deployment strategies
- **[Monitoring](operations/monitoring.md)** - Logging, metrics, and monitoring
- **[Performance Tuning](operations/performance-tuning.md)** - Performance optimization
- **[Security Hardening](operations/security-hardening.md)** - Production security checklist
- **[Backup & Recovery](operations/backup-recovery.md)** - Backup and disaster recovery

### Development
- **[Contributing](development/contributing.md)** - Contribution guidelines
- **[Development Setup](development/development-setup.md)** - Local development environment
- **[Testing Guide](development/testing-guide.md)** - Testing strategies and 90%+ coverage
- **[Test Coverage Report](development/test-coverage-report.md)** - Detailed coverage metrics and validation
- **[Code Standards](development/code-standards.md)** - Coding standards and conventions
- **[Release Process](development/release-process.md)** - Release and versioning workflow

## Find What You Need

### By Role
- **Developers** - [Development](development/) | [API Reference](api/) | [Architecture](architecture/)
- **DevOps/SRE** - [Operations](operations/) | [Deployment](operations/deployment-guide.md) | [Monitoring](operations/monitoring.md)
- **Security Engineers** - [Security Architecture](architecture/security-architecture.md) | [Security Hardening](operations/security-hardening.md)
- **Data Analysts** - [Quick Start](guides/quick-start.md) | [Database Guides](databases/) | [Tutorials](tutorials/)
- **Enterprise Users** - [Deployment Guide](operations/deployment-guide.md) | [Security](operations/security-hardening.md) | [Monitoring](operations/monitoring.md)

### By Use Case
- **First Time Setup** - [Installation](guides/installation-guide.md) -> [Quick Start](guides/quick-start.md) -> [First Database](tutorials/02-first-database.md)
- **Production Deployment** - [Deployment Guide](operations/deployment-guide.md) -> [Security Hardening](operations/security-hardening.md) -> [Monitoring](operations/monitoring.md)
- **Multi-Database Environment** - [Configuration](guides/configuration-guide.md) -> [Multi-Database Setup](tutorials/advanced-01-multi-database.md)
- **Secure Remote Access** - [SSH Tunneling](databases/ssh-tunneling.md) -> [SSH Setup Tutorial](tutorials/advanced-02-ssh-tunnels.md)
- **Troubleshooting Issues** - [Troubleshooting](guides/troubleshooting-guide.md) -> [Error Codes](api/error-codes.md)

### By Database Type
- **PostgreSQL Users** - [PostgreSQL Guide](databases/postgresql.md) -> [Performance Tuning](operations/performance-tuning.md)
- **MySQL Users** - [MySQL Guide](databases/mysql.md) -> [Configuration](guides/configuration-guide.md)
- **SQLite Users** - [SQLite Guide](databases/sqlite.md) -> [Quick Start](guides/quick-start.md)
- **SQL Server Users** - [SQL Server Guide](databases/sql-server.md) -> [Deployment Guide](operations/deployment-guide.md)

## Quick Navigation

| **I want to...** | **Go here** |
|---|---|
| Set up the server in 5 minutes | [Quick Start](guides/quick-start.md) |
| Connect to my first database | [First Database Tutorial](tutorials/02-first-database.md) |
| Deploy to production | [Deployment Guide](operations/deployment-guide.md) |
| Secure my deployment | [Security Hardening](operations/security-hardening.md) |
| Set up SSH tunneling | [SSH Tunneling Guide](databases/ssh-tunneling.md) |
| Understand the architecture | [System Architecture](architecture/system-architecture.md) |
| Contribute to the project | [Contributing Guide](development/contributing.md) |
| Monitor and troubleshoot | [Monitoring](operations/monitoring.md) |
| Optimize performance | [Performance Tuning](operations/performance-tuning.md) |
| Redact sensitive fields | [Field Redaction](features/field-redaction.md) |
| Manage databases via MCP | [MCP Tools Reference](api/mcp-tools-reference.md#sql_add_database) |

## External Resources

- **[Anthropic Claude](https://claude.ai)** - Claude AI assistant
- **[Model Context Protocol](https://github.com/anthropics/mcp)** - MCP specification
- **[TypeScript Documentation](https://www.typescriptlang.org/docs/)** - TypeScript reference

## Documentation Standards

All documentation follows these standards:
- **Clear and concise** writing style
- **Step-by-step instructions** with examples
- **Code samples** in multiple languages where applicable
- **Screenshots and diagrams** for complex procedures
- **Cross-references** to related documentation
- **Regular updates** to stay current with codebase

## Need Help?

Can't find what you're looking for? Here are some options:

1. **Search** the documentation using your browser's find function (Ctrl/Cmd+F)
2. **Check** the [troubleshooting guide](guides/troubleshooting-guide.md) for common issues
3. **Browse** the [examples](../examples/) folder for working configurations

---

**Last updated:** March 2026 | **Version:** 2.7.1
