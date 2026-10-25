# Troubleshooting Guide

This comprehensive guide helps you diagnose and resolve common issues with the Argos.

## Quick Diagnostic Checklist

### Before You Start
1. **Check server status**: Is the MCP server running?
2. **Verify configuration**: Does `config.ini` exist and have correct settings?
3. **Test database connectivity**: Can you connect directly to the database?
4. **Check Claude Code**: Is Claude Code properly configured?
5. **Review logs**: What do the server logs show?

### Getting Log Information
```bash
# Start the server (it waits for JSON-RPC on stdin)
npm start

# View recent log entries
tail -f argos.log

# Check for specific error patterns
grep -i error argos.log
```

The server never logs to the console: stdout carries the JSON-RPC stream, and
anything written there breaks the protocol. `argos.log` in the repository
root is the only place its own output goes.

## Server Startup Issues

### Issue: "No config.ini found"
```
Error: No config.ini found. Run setup to configure databases.
```

**Solution:**
```bash
# Run the setup wizard to create configuration
npm run setup

# Or copy and edit the template
cp config.ini.template config.ini
# Edit config.ini with your database settings
```

### Issue: Server Fails to Start
```
Error: Failed to initialize server
```

**Diagnostic Steps:**
1. **Check Node.js version**:
 ```bash
 node --version # Should be 22.0.0 or higher
 npm --version # Should be 8.0.0 or higher
 ```

2. **Verify dependencies**:
 ```bash
 npm install # Reinstall dependencies
 npm run build # Rebuild the project
 ```

3. **Check configuration syntax**:
 ```bash
 # Test configuration loading
 node -e "const ini = require('ini'); console.log(ini.parse(require('fs').readFileSync('config.ini', 'utf8')))"
 ```

### Issue: Module Import Errors
```
Error [ERR_MODULE_NOT_FOUND]: Cannot find module
```

**Solution:**
```bash
# Clean rebuild
rm -rf node_modules dist
npm install
npm run build

# Check if build completed successfully
ls -la dist/
```

## Database Connection Issues

### PostgreSQL Connection Problems

#### Issue: "Connection timeout"
```
 Connection timeout after 30000ms
```

**Solutions:**
1. **Increase timeout**:
 ```ini
 [database.postgres]
 timeout=60000 # 60 second timeout
 ```

2. **Check network connectivity**:
 ```bash
 # Test basic network connectivity
 ping your-db-host.com
 
 # Test port connectivity
 telnet your-db-host.com 5432
 # or using nc
 nc -zv your-db-host.com 5432
 ```

3. **Verify PostgreSQL is running**:
 ```bash
 # On the database server
 sudo systemctl status postgresql
 ps aux | grep postgres
 ```

#### Issue: "Authentication failed"
```
 Authentication failed for user "username"
```

**Solutions:**
1. **Verify credentials**:
 ```bash
 # Test connection with psql
 psql -h your-db-host.com -U username -d database_name
 ```

2. **Check pg_hba.conf** (on database server):
 ```bash
 sudo nano /etc/postgresql/13/main/pg_hba.conf
 
 # Add/modify line for your connection
 host database_name username client_ip/32 md5
 
 # Reload configuration
 sudo systemctl reload postgresql
 ```

3. **Check user permissions**:
 ```sql
 -- Connect as superuser and check user
 \du username
 
 -- Grant necessary permissions
 GRANT CONNECT ON DATABASE database_name TO username;
 GRANT USAGE ON SCHEMA public TO username;
 GRANT SELECT ON ALL TABLES IN SCHEMA public TO username;
 ```

#### Issue: SSL Connection Problems
```
 SSL connection required but server doesn't support SSL
```

**Solutions:**
1. **Disable SSL temporarily for testing**:
 ```ini
 [database.postgres]
 ssl=false
 ```

2. **Enable SSL on PostgreSQL server**:
 ```bash
 # Edit postgresql.conf
 ssl = on
 ssl_cert_file = 'server.crt'
 ssl_key_file = 'server.key'
 ```

### MySQL Connection Problems

#### Issue: "Access denied"
```
 Access denied for user 'username'@'host'
```

**Solutions:**
1. **Test direct connection**:
 ```bash
 mysql -h your-mysql-host.com -u username -p database_name
 ```

2. **Check MySQL user permissions**:
 ```sql
 -- Connect as root
 mysql -u root -p
 
 -- Check user exists and has permissions
 SELECT User, Host FROM mysql.user WHERE User = 'username';
 SHOW GRANTS FOR 'username'@'%';
 
 -- Create user if needed
 CREATE USER 'username'@'%' IDENTIFIED BY 'password';
 GRANT SELECT ON database_name.* TO 'username'@'%';
 FLUSH PRIVILEGES;
 ```

3. **Check MySQL bind address**:
 ```bash
 # Edit my.cnf
 bind-address = 0.0.0.0 # Allow external connections
 
 # Restart MySQL
 sudo systemctl restart mysql
 ```

#### Issue: "Client does not support authentication protocol"
```
 Client does not support authentication protocol requested by server
```

**Solution - MySQL 8.0+ Authentication:**
```sql
-- Use legacy authentication method
ALTER USER 'username'@'%' IDENTIFIED WITH mysql_native_password BY 'password';
FLUSH PRIVILEGES;
```

### SQLite Connection Problems

#### Issue: "SQLITE_CANTOPEN: unable to open database file"
```
 SQLITE_CANTOPEN: unable to open database file
```

**Solutions:**
1. **Check file path**:
 ```bash
 # Verify file exists
 ls -la /path/to/database.sqlite
 
 # Check permissions
 ls -la /path/to/ # Directory permissions
 ```

2. **Create directory if needed**:
 ```bash
 mkdir -p /path/to/database/directory
 chmod 755 /path/to/database/directory
 ```

3. **Set correct permissions**:
 ```bash
 # For read-write access
 chmod 644 /path/to/database.sqlite
 
 # For read-only access
 chmod 444 /path/to/database.sqlite
 ```

### SQL Server Connection Problems

#### Issue: "Login failed for user"
```
 Login failed for user 'username'
```

**Solutions:**
1. **Test with SQL Server Management Studio** or sqlcmd:
 ```bash
 sqlcmd -S server_name -U username -P password -d database_name
 ```

2. **Check SQL Server authentication mode**:
 ```sql
 -- Must be set to Mixed Mode for SQL Server authentication
 -- Check in SQL Server Management Studio: Server Properties > Security
 ```

3. **Enable TCP/IP connections**:
 ```
 SQL Server Configuration Manager > SQL Server Network Configuration 
 > Protocols for MSSQLSERVER > TCP/IP > Enabled
 ```

## SSH Tunnel Issues

### Issue: "SSH tunnel failed: Authentication failed"
```
 SSH tunnel failed: Authentication failed
```

**Solutions:**
1. **Test SSH connection manually**:
 ```bash
 # Test basic SSH connection
 ssh username@bastion-host.com
 
 # Test with specific key
 ssh -i /path/to/private/key username@bastion-host.com
 ```

2. **Check SSH key permissions**:
 ```bash
 # SSH keys must have correct permissions
 chmod 600 ~/.ssh/id_rsa
 chmod 600 ~/.ssh/id_rsa.pub
 chmod 700 ~/.ssh
 ```

3. **Verify SSH key format**:
 ```bash
 # Check if key is in correct format
 head -1 ~/.ssh/id_rsa
 # Should start with: -----BEGIN OPENSSH PRIVATE KEY-----
 # or: -----BEGIN RSA PRIVATE KEY-----
 ```

4. **Test key-based authentication**:
 ```bash
 # Add key to SSH agent
 ssh-add ~/.ssh/id_rsa
 ssh-add -l # List loaded keys
 ```

### Issue: "SSH tunnel connection refused"
```
 SSH tunnel connection refused to target host
```

**Solutions:**
1. **Verify database host is reachable from SSH server**:
 ```bash
 # From the SSH server, test database connectivity
 telnet internal-db-server 5432
 ```

2. **Check SSH server configuration**:
 ```bash
 # On SSH server, check if tunneling is allowed
 grep AllowTcpForwarding /etc/ssh/sshd_config
 # Should be: AllowTcpForwarding yes
 ```

3. **Test manual port forwarding**:
 ```bash
 # Test SSH port forwarding manually
 ssh -L 5433:internal-db-server:5432 username@bastion-host.com
 
 # In another terminal, test local connection
 psql -h localhost -p 5433 -U dbuser -d database
 ```

## Claude Code Integration Issues

### Issue: Claude Code doesn't see the SQL tools
```
Claude Code shows no SQL-related tools available
```

**Solutions:**
1. **Check Claude Code configuration**:
 ```json
 {
 "mcpServers": {
 "sql-database": {
 "command": "node",
 "args": ["/absolute/path/to/your/argos/dist/cli.js", "serve"],
 "env": {}
 }
 }
 }
 ```

2. **Verify absolute paths**:
 ```bash
 # Get absolute path to your installation
 pwd # From your Argos directory
 ls -la dist/cli.js # Verify file exists
 ```

3. **Check if server is running**:
 ```bash
 # Server should start without errors
 npm start
 ```

4. **Restart Claude Code** after configuration changes.

### Issue: Claude Code shows connection errors
```
Claude Code error: "Failed to connect to MCP server"
```

**Solutions:**
1. **Check server startup**:
 ```bash
 # Server should start and show:
 npm start
 # Expected output:
 # Argos running on stdio
 # Connection established: database_name
 ```

2. **Test server manually**:
 ```bash
 # Test with echo
 echo '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' | npm start
 ```

3. **Check file permissions**:
 ```bash
 chmod +x dist/cli.js
 ```

### Issue: Tools appear but queries fail
```
Claude shows SQL tools but queries return errors
```

**Solutions:**
1. **Test connection directly**:
 > Ask Claude: "Test the connection to my database"

2. **Check database permissions**:
 ```sql
 -- Ensure user can SELECT from tables
 SELECT * FROM information_schema.tables LIMIT 5;
 ```

3. **Review security settings**:
 ```ini
 # Check if SELECT-only mode is causing issues
 [database.name]
 select_only=true # Should allow SELECT queries
 ```

## Query Execution Issues

### Issue: "Query complexity exceeds limits"
```
 Query complexity score (150) exceeds safety threshold of 100
```

**Solutions:**
1. **Increase complexity limits**:
 ```ini
 [security]
 max_complexity_score=200
 max_joins=15
 max_subqueries=8
 ```

2. **Simplify the query**:
 - Break complex queries into smaller parts
 - Reduce the number of JOINs
 - Use temporary tables for intermediate results

3. **Temporarily disable limits for testing**:
 ```ini
 [security]
 max_complexity_score=1000
 ```

### Issue: "Query blocked in SELECT-only mode"
```
 Command 'INSERT' is not allowed in SELECT-only mode
```

**Solutions:**
1. **Use a full-access database for write operations**:
 ```ini
 [database.development]
 select_only=false # Allow all operations
 ```

2. **Or disable SELECT-only mode**:
 ```ini
 [database.production]
 select_only=false # Use with caution!
 ```

### Issue: "Query timeout"
```
 Query execution timeout after 30000ms
```

**Solutions:**
1. **Increase query timeout**:
 ```ini
 [extension]
 query_timeout=60000 # 60 seconds
 
 [database.slow_db]
 timeout=90000 # 90 seconds
 ```

2. **Optimize the query**:
 - Add appropriate indexes
 - Use EXPLAIN to analyze query plan
 - Consider query restructuring

## Performance Issues

### Issue: Slow query execution
```
Queries taking much longer than expected
```

**Solutions:**
1. **Check database performance**:
 ```sql
 -- PostgreSQL: Check slow queries
 SELECT query, mean_time, calls 
 FROM pg_stat_statements 
 ORDER BY mean_time DESC LIMIT 10;
 
 -- MySQL: Check slow query log
 SET GLOBAL slow_query_log = 1;
 SET GLOBAL long_query_time = 2;
 ```

2. **Optimize server settings**:
 ```ini
 [extension]
 max_rows=500 # Reduce result set size
 query_timeout=15000 # Shorter timeout
 ```

3. **Add database indexes**:
 ```sql
 -- Add indexes for frequently queried columns
 CREATE INDEX idx_users_email ON users(email);
 CREATE INDEX idx_posts_user_id ON posts(user_id);
 ```

### Issue: High memory usage
```
Server consuming excessive memory
```

**Solutions:**
1. **Limit result set size**:
 ```ini
 [extension]
 max_rows=100 # Smaller result sets
 max_batch_size=5 # Fewer concurrent queries
 ```

2. **Monitor query patterns**:
 ```bash
 # Check for queries returning large datasets
 grep "rows returned" argos.log
 ```

## Security Issues

### Issue: "Suspicious pattern detected"
```
 Query contains potentially dangerous patterns
```

**Solutions:**
1. **Review the blocked query** - the security system may have flagged a legitimate query
2. **Adjust security settings if needed**:
 ```ini
 [security]
 max_complexity_score=150 # Increase if legitimate queries are blocked
 ```

3. **For development/testing**, temporarily disable strict security:
 ```ini
 [database.development]
 select_only=false # Allow more query types
 ```

## Configuration Issues

### Issue: "Invalid configuration"
```
 Invalid configuration: Missing required fields
```

**Solutions:**
1. **Validate configuration format**:
 ```bash
 # Check INI file syntax
 node -c "require('ini').parse(require('fs').readFileSync('config.ini', 'utf8'))"
 ```

2. **Verify required fields**:
 ```ini
 # PostgreSQL/MySQL/SQL Server require:
 [database.name]
 type=postgresql # Required
 host=localhost # Required
 database=dbname # Required
 username=user # Required
 password=pass # Required
 
 # SQLite requires:
 [database.sqlite]
 type=sqlite # Required
 file=./data.db # Required
 ```

3. **Check for common typos**:
 ```ini
 # Common mistakes:
 type=postgres # Should be: postgresql
 type=sqlserver # Should be: mssql
 ```

## Getting Additional Help

### Enable Debug Logging

There is no general verbosity switch: the server logs at INFO to
`argos.log`, and that file is already the full picture of what it did.

One extra trace is available, for the SSH handshake — algorithm negotiation,
host-key exchange and authentication steps. It is off by default because it is
verbose:

```bash
# Adds the ssh2 handshake trace to argos.log, prefixed [DEBUG]
SSH_DEBUG=true npm start

# Then read it back
grep '\[DEBUG\]' argos.log
```

Do not pipe the server's stdout to a file: that stream is the JSON-RPC channel,
not the log. Redirecting or teeing it will break the connection to the client.

### Collect Diagnostic Information

When reporting issues, include:

1. **System information**:
 ```bash
 node --version
 npm --version
 cat package.json | grep version
 uname -a # Linux/macOS
 ```

2. **Configuration (sanitized)**:
 ```ini
 # Remove passwords/sensitive info before sharing
 [database.example]
 type=postgresql
 host=[REDACTED]
 username=[REDACTED]
 # ... other non-sensitive settings
 ```

3. **Error logs** (with sensitive info removed)

4. **Steps to reproduce** the issue

### Common Log Locations
- **Server log**: `./argos.log` in the repository root, owner-readable only
- **Previous run**: `./argos.log.1` — the log is rotated on every start, so
  the run before the current one is still there
- **Setup wizard**: `./setup.log`
- **Audit records**: `~/.argos/audit/<database>.log`, one line per query with
  a hash of the SQL rather than the SQL itself. Installations upgraded from a
  pre-rebrand version will find their earlier records in `~/.sql-ts/audit`.

### Community Support
- **GitHub Issues**: [Report bugs and issues](https://github.com/AraneaDev/argos/issues)
- **GitHub Discussions**: [Ask questions and get help](https://github.com/AraneaDev/argos/discussions)
- **Documentation**: [Browse all documentation](../README.md)

---

** Pro Tip**: Start with simple configurations and gradually add complexity. Test each component (database connection, SSH tunnel, Claude Code integration) independently before combining them.