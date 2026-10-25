# Security Hardening Guide

This guide provides comprehensive security recommendations for deploying the Argos in production environments. Follow these guidelines to ensure your deployment is secure and resilient against threats.

## Security Architecture Overview

The Argos implements defense-in-depth security with multiple layers:

1. **Network Security** - Encrypted connections and network isolation
2. **Authentication & Authorization** - Database user permissions and access control
3. **Query Security** - SQL injection prevention and query validation
4. **Configuration Security** - Secure configuration management
5. **Operational Security** - Monitoring, logging, and incident response

## Production Security Checklist

### Essential Security Measures (Must Have)

- [ ] **Enable SELECT-only mode** for production databases
- [ ] **Use SSL/TLS encryption** for all database connections
- [ ] **Implement SSH tunneling** for remote database access
- [ ] **Create dedicated database users** with minimal permissions
- [ ] **Use strong, unique passwords** for all accounts
- [ ] **Enable comprehensive audit logging**
- [ ] **Set strict query complexity limits**
- [ ] **Secure configuration files** with proper permissions
- [ ] **Regularly update dependencies**
- [ ] **Monitor for security violations**

### Advanced Security Measures (Recommended)

- [ ] **Implement network segmentation**
- [ ] **Use certificate-based SSH authentication**
- [ ] **Enable database connection encryption at rest**
- [ ] **Implement rate limiting**
- [ ] **Set up automated security scanning**
- [ ] **Create incident response procedures**
- [ ] **Regular security audits**

## Database Security Configuration

### PostgreSQL Security Hardening

#### 1. Create Dedicated Read-Only User
```sql
-- Create user with strong password
CREATE USER claude_readonly WITH PASSWORD 'SecureRandomPassword123!@#';

-- Grant minimal necessary permissions
GRANT USAGE ON SCHEMA public TO claude_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO claude_readonly;
GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO claude_readonly;

-- Ensure future tables are also accessible
ALTER DEFAULT PRIVILEGES IN SCHEMA public 
 GRANT SELECT ON TABLES TO claude_readonly;

-- Allow schema introspection (required for schema capture)
GRANT SELECT ON information_schema.tables TO claude_readonly;
GRANT SELECT ON information_schema.columns TO claude_readonly;
GRANT SELECT ON information_schema.table_constraints TO claude_readonly;

-- Revoke dangerous permissions
REVOKE CREATE ON SCHEMA public FROM claude_readonly;
REVOKE ALL ON DATABASE production FROM claude_readonly;
```

#### 2. Configure SSL/TLS
```bash
# In postgresql.conf
ssl = on
ssl_cert_file = '/path/to/server.crt'
ssl_key_file = '/path/to/server.key'
ssl_ca_file = '/path/to/ca.crt'
ssl_crl_file = '/path/to/server.crl'

# Require SSL for the readonly user
# In pg_hba.conf
hostssl production claude_readonly 0.0.0.0/0 md5
```

#### 3. Network Security
```bash
# In postgresql.conf - restrict listening addresses
listen_addresses = 'localhost,10.0.0.100' # Specific IPs only

# In pg_hba.conf - restrict client connections
hostssl production claude_readonly 10.0.0.0/24 md5 # Specific network only
```

### MySQL Security Hardening

#### 1. Create Dedicated Read-Only User
```sql
-- Create user with strong password
CREATE USER 'claude_readonly'@'10.0.0.%' IDENTIFIED BY 'SecureRandomPassword123!@#';

-- Grant minimal permissions
GRANT SELECT ON production.* TO 'claude_readonly'@'10.0.0.%';
GRANT SHOW VIEW ON production.* TO 'claude_readonly'@'10.0.0.%';

-- Allow information_schema access
GRANT SELECT ON information_schema.* TO 'claude_readonly'@'10.0.0.%';

-- Explicitly deny dangerous operations
REVOKE INSERT, UPDATE, DELETE, DROP, CREATE, ALTER, INDEX, REFERENCES 
 ON production.* FROM 'claude_readonly'@'10.0.0.%';

-- Set resource limits
ALTER USER 'claude_readonly'@'10.0.0.%' 
 WITH MAX_QUERIES_PER_HOUR 1000 
 MAX_CONNECTIONS_PER_HOUR 100;

FLUSH PRIVILEGES;
```

#### 2. Enable SSL
```bash
# In my.cnf
[mysqld]
ssl-ca=/path/to/ca.pem
ssl-cert=/path/to/server-cert.pem
ssl-key=/path/to/server-key.pem
require_secure_transport=ON

# Force SSL for the readonly user
REQUIRE SSL FOR 'claude_readonly'@'10.0.0.%';
```

### SQL Server Security Hardening

#### 1. Create Dedicated User
```sql
-- Create login and user
CREATE LOGIN claude_readonly WITH PASSWORD = 'SecureRandomPassword123!@#';
USE production;
CREATE USER claude_readonly FOR LOGIN claude_readonly;

-- Grant read-only permissions
ALTER ROLE db_datareader ADD MEMBER claude_readonly;
GRANT VIEW DEFINITION TO claude_readonly;

-- Explicitly deny dangerous operations
DENY INSERT, UPDATE, DELETE, CREATE, DROP, ALTER TO claude_readonly;

-- Set connection limits
ALTER LOGIN claude_readonly WITH DEFAULT_DATABASE = production;
```

#### 2. Enable Encryption
```sql
-- Force encrypted connections
ALTER LOGIN claude_readonly REQUIRE SSL;

-- Enable Transparent Data Encryption (TDE)
USE master;
CREATE MASTER KEY ENCRYPTION BY PASSWORD = 'MasterKeyPassword123!';
CREATE CERTIFICATE TDECert WITH SUBJECT = 'TDE Certificate';
USE production;
CREATE DATABASE ENCRYPTION KEY WITH ALGORITHM = AES_256 ENCRYPTION BY SERVER CERTIFICATE TDECert;
ALTER DATABASE production SET ENCRYPTION ON;
```

## MCP Server Security Configuration

### Production Configuration Template
```ini
[database.production]
type=postgresql
host=internal-db.company.local
port=5432
database=production
username=claude_readonly
password=SecureRandomPassword123!@#
ssl=true
select_only=true # <- Critical: Enable read-only mode
timeout=15000 # Short timeout for security

# SSH Tunnel (Required for remote access)
ssh_host=bastion.company.com
ssh_port=22
ssh_username=tunnel_user
ssh_private_key=/secure/path/ssh_key
local_port=0

[extension]
max_rows=500 # Limit result set size
query_timeout=10000 # Short query timeout
max_batch_size=3 # Limit batch operations
debug=false # Disable debug info

[security]
max_joins=5 # Strict complexity limits
max_subqueries=3
max_unions=2
max_group_bys=3
max_complexity_score=50 # Very strict complexity limit
max_query_length=5000 # Limit query length
```

### File System Security

#### 1. Secure Configuration Files
```bash
# Set restrictive permissions
chmod 600 config.ini
chown app_user:app_group config.ini

# Create secure directory structure
sudo mkdir -p /opt/argos/{config,logs,keys}
sudo chown -R app_user:app_group /opt/argos
sudo chmod 750 /opt/argos
sudo chmod 700 /opt/argos/keys
```

#### 2. SSH Key Security
```bash
# Generate dedicated SSH key for the service
ssh-keygen -t ed25519 -f /opt/argos/keys/tunnel_key -C "claude-mcp-tunnel"

# Set secure permissions
chmod 600 /opt/argos/keys/tunnel_key
chmod 644 /opt/argos/keys/tunnel_key.pub
chown app_user:app_group /opt/argos/keys/*

# Add public key to bastion host
# On bastion host:
mkdir -p ~/.ssh
echo "ssh-ed25519 AAAAC3... claude-mcp-tunnel" >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
```

## Network Security

### SSH Bastion Host Configuration

#### 1. Harden SSH Configuration
```bash
# /etc/ssh/sshd_config on bastion host
Port 2222 # Non-standard port
Protocol 2
PasswordAuthentication no # Disable password auth
PubkeyAuthentication yes
AuthorizedKeysFile .ssh/authorized_keys
PermitRootLogin no
MaxAuthTries 3
LoginGraceTime 30
MaxStartups 10:30:100
ClientAliveInterval 300
ClientAliveCountMax 2
AllowUsers tunnel_user # Restrict to specific users
AllowTcpForwarding yes # Required for tunneling
GatewayPorts no
X11Forwarding no
PermitTunnel no
```

#### 2. Network Access Control
```bash
# Configure firewall (iptables example)
# Allow SSH from MCP server only
iptables -A INPUT -p tcp -s MCP_SERVER_IP --dport 2222 -j ACCEPT

# Allow database access from bastion to database server
iptables -A OUTPUT -p tcp -d DATABASE_SERVER_IP --dport 5432 -j ACCEPT

# Drop all other traffic
iptables -A INPUT -j DROP
iptables -A OUTPUT -j DROP
```

### Database Network Security

#### 1. Network Segmentation
```bash
# Database should be in private subnet
# Allow connections only from bastion host
Database Subnet: 10.0.2.0/24 (Private)
Bastion Subnet: 10.0.1.0/24 (Public-facing)
MCP Server: 10.0.3.0/24 (Application tier)

# Security group rules (AWS example)
Database Security Group:
 - Inbound: Port 5432 from Bastion Security Group only
 - Outbound: None

Bastion Security Group:
 - Inbound: Port 2222 from MCP Server IP only
 - Outbound: Port 5432 to Database Security Group only
```

#### 2. Database Firewall Rules
```bash
# PostgreSQL: Configure pg_hba.conf for network restrictions
hostssl production claude_readonly 10.0.1.0/24 md5 # Bastion subnet only
host production claude_readonly 127.0.0.1/32 md5 # Local connections

# MySQL: Bind to specific interface
bind-address = 10.0.2.100 # Database server private IP
```

## Monitoring and Logging

### Security Event Monitoring

#### 1. Application-Level Logging

Logging needs no configuration, and there is nothing to switch on. The server
writes to two places, both created owner-only:

| What | Where | Mode |
|------|-------|------|
| Server log | `argos.log` in the install directory, previous run rotated to `argos.log.1` | `0600` |
| Audit records | `~/.argos/audit/<database>.log` | `0600` in a `0700` directory |

Each audit line carries a timestamp, the database, a hash of the statement, the
duration and the outcome. The SQL itself is never written, so the file records
what was run and when without becoming a second copy of the data.

Console output is off by design: stdout carries the JSON-RPC stream, and writing
anything else there breaks the protocol.

```bash
# Confirm the permissions are what they should be
ls -l argos.log
ls -ld ~/.argos/audit
```

#### 2. Database Query Logging
```sql
-- PostgreSQL: Enable query logging
ALTER SYSTEM SET log_statement = 'all';
ALTER SYSTEM SET log_min_duration_statement = 0;
SELECT pg_reload_conf();

-- MySQL: Enable general and slow query logs
SET GLOBAL general_log = 'ON';
SET GLOBAL slow_query_log = 'ON';
SET GLOBAL long_query_time = 2;
```

#### 3. Security Monitoring Rules
```bash
# Monitor for security violations
grep "Query blocked" /var/log/claude-mcp/security.log
grep "Authentication failed" /var/log/claude-mcp/server.log
grep "SSH tunnel" /var/log/claude-mcp/tunnel.log

# Set up alerts for critical events
# Example: Send alert if more than 10 blocked queries in 5 minutes
if [ $(grep -c "Query blocked" /var/log/claude-mcp/security.log | tail -100) -gt 10 ]; then
 send_alert "High number of blocked queries detected"
fi
```

### Performance Monitoring

#### 1. Query Performance Tracking
```sql
-- PostgreSQL: Enable pg_stat_statements
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

-- Monitor query patterns
SELECT query, calls, mean_time, max_time 
FROM pg_stat_statements 
WHERE query LIKE '%claude_readonly%'
ORDER BY calls DESC;
```

#### 2. Connection Monitoring
```bash
# Monitor active connections
netstat -an | grep :5432 | wc -l

# Monitor SSH tunnel connections
ss -tulpn | grep :2222

# Set connection limits
# PostgreSQL: max_connections = 100
# MySQL: max_connections = 100
```

## Incident Response

### Security Incident Classification

#### Level 1: Information/Warning
- Single blocked query
- Failed authentication attempt
- Configuration warning

**Response**: Log and monitor

#### Level 2: Moderate Risk
- Multiple blocked queries from same source
- Repeated authentication failures
- Unusual query patterns

**Response**: Investigate and potentially block source

#### Level 3: High Risk
- SQL injection attempts detected
- Privilege escalation attempts
- System command injection attempts

**Response**: Immediate investigation, potential service shutdown

#### Level 4: Critical
- Successful security breach
- Data exfiltration detected
- System compromise

**Response**: Emergency procedures, incident response team activation

### Incident Response Procedures

#### 1. Immediate Response
```bash
# Block suspicious source IP
iptables -A INPUT -s SUSPICIOUS_IP -j DROP

# Disable database user if compromised
# PostgreSQL
ALTER USER claude_readonly NOLOGIN;

# MySQL
ALTER USER 'claude_readonly'@'%' ACCOUNT LOCK;
```

#### 2. Investigation
```bash
# Collect evidence
cp /var/log/claude-mcp/* /secure/incident-logs/
cp config.ini /secure/incident-logs/
ps aux > /secure/incident-logs/processes.txt
netstat -an > /secure/incident-logs/network.txt
```

#### 3. Recovery
```bash
# Rotate credentials
# Generate new SSH keys
ssh-keygen -t ed25519 -f /opt/argos/keys/tunnel_key_new

# Change database passwords
ALTER USER claude_readonly WITH PASSWORD 'NewSecurePassword123!@#';

# Update configuration with new credentials
```

## Security Maintenance

### Regular Security Tasks

#### Daily
- [ ] Review security logs for violations
- [ ] Monitor failed authentication attempts
- [ ] Check system resource usage

#### Weekly
- [ ] Review database query patterns
- [ ] Update security monitoring rules
- [ ] Check for software updates

#### Monthly
- [ ] Rotate SSH keys
- [ ] Update database passwords
- [ ] Review and update security configurations
- [ ] Conduct security scan

#### Quarterly
- [ ] Security audit and penetration testing
- [ ] Update incident response procedures
- [ ] Review access permissions
- [ ] Security training for team members

### Automated Security Checks

#### 1. Configuration Validation
```bash
#!/bin/bash
# security-check.sh

# Check file permissions
if [ $(stat -c %a config.ini) != "600" ]; then
 echo "WARNING: config.ini permissions not secure"
fi

# Check for passwords in config
if grep -q "password=.*" config.ini; then
 echo "INFO: Passwords found in config (expected)"
fi

# Check SSL configuration
if ! grep -q "ssl=true" config.ini; then
 echo "WARNING: SSL not enabled for all databases"
fi
```

#### 2. Dependency Security Scanning
```bash
# Check for vulnerable dependencies
npm audit

# Update dependencies
npm update

# Check for known security issues
npm audit fix
```

## Security Best Practices Summary

### Configuration Security
- Use SELECT-only mode for production databases
- Enable SSL/TLS for all database connections
- Implement SSH tunneling for remote access
- Set strict query complexity limits
- Use strong, unique passwords
- Secure file system permissions

### Network Security
- Network segmentation and firewall rules
- SSH bastion host hardening
- Database network access control
- Regular security monitoring

### Operational Security
- Comprehensive logging and monitoring
- Incident response procedures
- Regular security maintenance
- Security training and awareness

### Database Security
- Dedicated database users with minimal permissions
- Database-level encryption
- Query logging and monitoring
- Regular access review

By following these security hardening guidelines, you can significantly reduce the attack surface and improve the security posture of your Argos deployment. Remember that security is an ongoing process that requires regular maintenance, monitoring, and updates.

---

** Security Notice**: This guide provides general security recommendations. Always consult with your security team and conduct thorough testing before implementing changes in production environments.