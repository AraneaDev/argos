# SQLite Working Demo - 5 Minute Setup

**Objective**: Get Argos running with zero external dependencies in under 5 minutes.

## Prerequisites

- Node.js 24+ installed
- argos package installed (`npm install -g argos`)
- Command line access

## Try It Now!

### Step 1: Run the Demo
```bash
# Clone or navigate to this directory
cd examples/working-examples/sqlite-demo

# Run the complete demo (automated)
./run-demo.sh

# Or run manually step-by-step
./setup-demo.sh # Create database and config
./start-server.sh # Start Argos
./test-queries.sh # Test sample queries
./stop-server.sh # Clean shutdown
```

### Step 2: Verify Results
After running the demo, you should see:
```
 SQLite database created with sample data
 Argos started successfully
 5 test queries executed successfully
 Server responded to MCP protocol
 Demo completed successfully
```

## What This Demo Shows

### Database Structure Created
- **users** table with 5 sample users
- **orders** table with 8 sample orders 
- **departments** lookup table
- Foreign key relationships between tables

### Queries Demonstrated
1. Simple SELECT with count
2. JOIN operations across tables
3. Aggregation with GROUP BY
4. Filtering with WHERE clauses
5. Complex analytical queries

### MCP Protocol Features
- `sql_list_databases` - List configured databases
- `sql_query` - Execute SQL queries safely
- `sql_get_schema` - Retrieve table structures
- Error handling and security validation

## Files in This Demo

- `README.md` - This file
- `run-demo.sh` - Complete automated demo
- `setup-demo.sh` - Database and config setup
- `start-server.sh` - Server startup script
- `test-queries.sh` - Query test suite
- `stop-server.sh` - Clean shutdown script
- `config.ini` - Argos configuration
- `sample-queries.sql` - Test SQL queries
- `create-database.sql` - Database schema
- `register-with-claude.sh` - Registers the demo with Claude Code

## Manual Setup Instructions

### 1. Create the Database
```bash
sqlite3 demo.db < create-database.sql
```

### 2. Verify Data
```bash
sqlite3 demo.db "SELECT COUNT(*) as user_count FROM users;"
# Expected output: 5

sqlite3 demo.db "SELECT COUNT(*) as order_count FROM orders;"
# Expected output: 8
```

### 3. Start Argos
```bash
argos serve --config config.ini &
SERVER_PID=$!
echo "Server started with PID: $SERVER_PID"
```

### 4. Test MCP Protocol
```bash
# List tools
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' | argos serve --test

# List databases
echo '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"sql_list_databases","arguments":{}}}' | argos serve --test

# Execute query
echo '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"sql_query","arguments":{"database":"demo","query":"SELECT COUNT(*) as total FROM users"}}}' | argos serve --test
```

### 5. Shutdown
```bash
kill $SERVER_PID
```

## Claude Code Integration

### 1. Register the Demo
```bash
# setup-demo.sh writes this script with the right absolute paths
./register-with-claude.sh

# Confirm it connected
claude mcp list
```

### 2. Start a New Claude Code Session

MCP servers are resolved when a session starts, so open a new one to pick up the registration.

### 3. Test in Claude
Ask Claude these questions to verify the integration:

1. "What databases do you have access to?"
2. "Show me the structure of the users table" 
3. "List all users with their departments"
4. "What are the total sales by department?"
5. "Show me the most expensive order"

Expected responses should show actual data from the demo database.

## Troubleshooting

### Database Not Created
```bash
# Check if SQLite is installed
sqlite3 --version

# Manually create database
sqlite3 demo.db < create-database.sql
```

### Server Won't Start
```bash
# Check if port is in use
lsof -i :3000

# Try different port
argos serve --config config.ini --port 3001
```

### Permission Errors
```bash
# Check file permissions
ls -la demo.db config.ini

# Fix permissions if needed
chmod 644 demo.db config.ini
```

### MCP Protocol Test Fails
```bash
# Check server logs
tail -f argos.log

# Test with curl instead
curl -X POST http://localhost:3000/mcp \
 -H "Content-Type: application/json" \
 -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

## Performance Benchmarks

On a typical development machine, this demo should show:

- Database creation: < 1 second
- Server startup: < 3 seconds
- Query response time: < 50ms per query
- Memory usage: < 50MB
- Total demo time: < 2 minutes

## Next Steps

After completing this demo:

1. **Explore PostgreSQL**: Try the [PostgreSQL production example](../postgresql-production/)
2. **Learn Security**: Review [security configuration](../../../docs/guides/security-guide.md)
3. **Add Real Data**: Connect to your own SQLite databases
4. **API Integration**: Try the [Python client example](../api-integration/)

## Demo Checklist

Use this checklist to verify the demo works:

- [ ] SQLite database created successfully
- [ ] 5 users inserted into users table
- [ ] 8 orders inserted into orders table
- [ ] config.ini file created and valid
- [ ] Argos starts without errors
- [ ] Server responds to health check
- [ ] MCP protocol tools/list works
- [ ] Sample queries execute successfully
- [ ] Error handling works for invalid queries
- [ ] Server shuts down cleanly
- [ ] Claude Code integration configured
- [ ] Claude can query the demo database

## Learning Objectives

By completing this demo, you'll understand:

- How to configure Argos with SQLite
- Basic MCP protocol communication
- SQL query execution and results
- Error handling and validation
- Claude Code integration
- Security considerations for database access

## Related Resources

- [SQLite Documentation](https://www.sqlite.org/docs.html)
- [Argos Configuration Guide](../../../docs/guides/configuration-guide.md)
- [MCP Protocol Reference](../../../docs/api/mcp-tools-reference.md)