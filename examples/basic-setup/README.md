# Basic Setup Examples

This directory contains simple, minimal examples for getting started with Argos quickly. These examples are perfect for new users who want to get up and running in minutes.

## Directory Structure

```
basic-setup/
|-- README.md # This file
|-- simple-sqlite.ini # Minimal SQLite configuration
|-- single-postgresql.ini # Basic PostgreSQL setup
|-- single-mysql.ini # Basic MySQL configuration
|-- multiple-databases.ini # Multiple database example
|-- docker-compose-demo.yml # Quick Docker demo setup
\-- test-queries.sql # Sample test queries
```

## Quick Start Options

### Option 1: SQLite (Simplest)
Perfect for testing and local development:

```bash
# Copy the SQLite configuration
cp examples/basic-setup/simple-sqlite.ini config.ini

# Start the server
npm start
```

### Option 2: PostgreSQL
Connect to an existing PostgreSQL database:

```bash
# Copy and edit the PostgreSQL configuration
cp examples/basic-setup/single-postgresql.ini config.ini
# Edit config.ini with your database details
npm start
```

### Option 3: Multiple Databases
Work with multiple databases simultaneously:

```bash
# Copy the multi-database configuration
cp examples/basic-setup/multiple-databases.ini config.ini
# Edit config.ini with your database details
npm start
```

### Option 4: Docker Demo
Quick containerized demo environment:

```bash
# Start demo environment
docker-compose -f examples/basic-setup/docker-compose-demo.yml up -d

# Use the provided config
cp examples/basic-setup/docker-demo-config.ini config.ini
npm start
```

## Configuration Examples

Each configuration file demonstrates:
- **Minimal required settings** for each database type
- **Security best practices** (SELECT-only mode)
- **Performance tuning** basics
- **Common use cases** and scenarios

## Testing Your Setup

Use the provided test queries to verify your configuration:

```bash
# Test basic connection
npm run test

# Manual query testing
# (See test-queries.sql for example queries)
```

## Next Steps

After getting basic setup working:

1. **Security**: Review the [Security Guide](../../docs/guides/security-guide.md)
2. **Claude Integration**: Check [Claude Integration Tutorial](../../docs/tutorials/03-claude-integration.md)
3. **Advanced Configuration**: Explore [Multi-Database Setup](../../docs/tutorials/advanced-01-multi-database.md)
4. **Production**: See [Deployment Guide](../../docs/operations/deployment-guide.md)

## Common Issues

### Connection Failures
- Verify database credentials in config.ini
- Check firewall and network connectivity
- Ensure database service is running

### Permission Errors
- Check user permissions on the database
- Verify SELECT-only mode if enabled
- Review database-specific access control

### Configuration Errors
- Validate config.ini syntax
- Check required fields for your database type
- Run `npm run setup` to create a new configuration

## Support

- **Documentation**: [docs/README.md](../../docs/README.md)
- **Troubleshooting**: [docs/guides/troubleshooting-guide.md](../../docs/guides/troubleshooting-guide.md)
- **Issues**: [GitHub Issues](https://github.com/AraneaDev/argos/issues)

## File Descriptions

| File | Purpose | Database Type |
|------|---------|---------------|
| `simple-sqlite.ini` | Minimal SQLite setup for testing | SQLite |
| `single-postgresql.ini` | Basic PostgreSQL connection | PostgreSQL |
| `single-mysql.ini` | Basic MySQL/MariaDB setup | MySQL |
| `multiple-databases.ini` | Multi-database configuration | Mixed |
| `docker-compose-demo.yml` | Containerized demo environment | PostgreSQL/MySQL |
| `test-queries.sql` | Sample queries for testing | All |