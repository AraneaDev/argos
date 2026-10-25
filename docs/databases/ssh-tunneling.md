# SSH Tunneling Configuration Guide

This guide covers SSH tunnel setup, configuration, and troubleshooting for secure database connections through the Argos.

## Overview

SSH tunneling provides an additional security layer for database connections by encrypting traffic through a secure SSH connection. The Argos includes a comprehensive SSH tunnel manager that handles connection establishment, monitoring, and automatic reconnection.

**Use Cases:**
- Connect to databases behind firewalls
- Secure connections over untrusted networks
- Access cloud databases through bastion hosts
- Comply with security policies requiring tunnel access
- Multi-hop connections through jump servers

## Quick Start

### 1. Basic SSH Tunnel Configuration

Add SSH parameters to your database configuration:

```ini
[database.production_tunnel]
type=postgresql
host=internal-db.company.com # Internal database host
port=5432
database=production_app
username=app_user
password=db_password
ssl=true
select_only=true

# SSH Tunnel Configuration
ssh_host=bastion.company.com
ssh_port=22
ssh_username=tunnel_user
ssh_private_key=/path/to/private/key
```

### 2. Test SSH Connection

```bash
# Test SSH connection first
ssh -i /path/to/private/key tunnel_user@bastion.company.com

# Test database connection through tunnel
# Test it from Claude with the sql_test_connection tool, database: production_tunnel
```

## SSH Configuration Options

### Required SSH Parameters

| Parameter | Description | Example |
|-----------|-------------|---------|
| `ssh_host` | SSH server hostname | `bastion.company.com` |
| `ssh_username` | SSH username | `tunnel_user` |
| `ssh_private_key` | Path to private key OR key content | `/home/user/.ssh/id_rsa` |

### Optional SSH Parameters

| Parameter | Description | Default | Example |
|-----------|-------------|---------|---------|
| `ssh_port` | SSH server port | `22` | `2222` |
| `ssh_password` | SSH password (if not using keys) | None | `ssh_password123` |
| `ssh_passphrase` | Private key passphrase | None | `key_passphrase` |

### Authentication Methods

#### 1. Private Key Authentication (Recommended)

```ini
[database.key_auth]
type=mysql
host=mysql.internal.company.com
port=3306
database=app_db
username=db_user
password=db_pass

# SSH with private key file
ssh_host=bastion.company.com
ssh_port=22
ssh_username=deploy_user
ssh_private_key=/home/user/.ssh/deploy_key
ssh_passphrase=optional_key_passphrase
```

#### 2. Private Key Content (Inline)

```ini
[database.inline_key]
type=postgresql
host=pg.internal.net
database=production
username=readonly
password=secure_pass

# SSH with inline private key
ssh_host=jump.company.com
ssh_username=service_user
ssh_private_key=-----BEGIN OPENSSH PRIVATE KEY-----
<the key body, unwrapped>
-----END OPENSSH PRIVATE KEY-----
```

Prefer a path over inline content. A key pasted into `config.ini` cannot have
its own permissions checked — the file's mode is all that protects it — and it
is one careless `cat` away from a terminal history. With a path, Argos refuses
to read a key that group or others can read.

#### 3. Password Authentication

```ini
[database.password_auth]
type=sqlite
file=/remote/path/database.db

# SSH with password (less secure)
ssh_host=server.company.com
ssh_username=user
ssh_password=ssh_password123
```

## SSH Key Management

### Generate SSH Key Pair

```bash
# Generate new key pair
ssh-keygen -t rsa -b 4096 -f ~/.ssh/claude_tunnel_key
ssh-keygen -t ed25519 -f ~/.ssh/claude_tunnel_ed25519

# Generate with comment
ssh-keygen -t rsa -b 4096 -C "claude-mcp-tunnel@company.com" -f ~/.ssh/claude_tunnel
```

### Key Formats Supported

The SSH tunnel manager supports these key formats:
- **OpenSSH format** (default for ssh-keygen)
- **PEM format** (traditional RSA/DSA keys)
- **PKCS#8 format**

### Key Types Supported

- **RSA** (2048, 3072, 4096 bits)
- **Ed25519** (recommended for security)
- **ECDSA** (P-256, P-384, P-521)
- **DSA** (deprecated, not recommended)

### Deploy Public Key

```bash
# Copy public key to SSH server
ssh-copy-id -i ~/.ssh/claude_tunnel_key.pub tunnel_user@bastion.company.com

# Or manually add to authorized_keys
cat ~/.ssh/claude_tunnel_key.pub | ssh tunnel_user@bastion.company.com "mkdir -p ~/.ssh && cat >> ~/.ssh/authorized_keys"
```

## Advanced SSH Configuration

### Multi-Hop Tunneling

For complex network topologies:

```ini
# First hop to bastion host
[database.multi_hop]
type=postgresql
host=database.private.net
port=5432
database=secure_app
username=app_readonly
password=secure_db_pass

# SSH tunnel through bastion to internal network
ssh_host=bastion.company.com
ssh_username=tunnel_user
ssh_private_key=/path/to/bastion_key

# Note: Multi-hop requires bastion host to have access to database.private.net
```

### Custom SSH Ports

```ini
[database.custom_port]
type=mysql
host=mysql.internal.company.com
port=3306
database=application
username=mysql_user
password=mysql_pass

# SSH server on custom port
ssh_host=ssh.company.com
ssh_port=2222
ssh_username=service_account
ssh_private_key=/etc/ssh/service_key
```

### SSH Agent Integration

When using SSH agent:

```bash
# Add key to SSH agent
ssh-add ~/.ssh/claude_tunnel_key

# Verify key is loaded
ssh-add -l
```

Configuration remains the same - the tunnel manager will use the agent automatically.

## Network Configuration

### Firewall Requirements

#### Outbound (from MCP Server)
- SSH Server: Port 22 (or custom SSH port)
- Database: Usually local tunnel port (dynamic)

#### SSH Server Requirements
- SSH daemon running and accessible
- User account with appropriate permissions
- Public key authentication configured
- Network routing to database server

### Port Forwarding

The tunnel creates a local port forward:

```
Local Machine:random_port -> SSH Server -> Database:database_port
```

Example flow:
```
MCP Server:50123 -> bastion.company.com:22 -> mysql.internal.net:3306
```

### Dynamic Port Assignment

The tunnel manager automatically:
- Assigns available local ports (typically 50000-65535 range)
- Handles port conflicts
- Provides port information in logs
- Manages multiple concurrent tunnels

## Tunnel Management

### Tunnel Lifecycle

1. **Connection Request**: Database connection triggers tunnel creation
2. **SSH Authentication**: Authenticate with SSH server
3. **Port Forward Setup**: Create local listener and remote forward
4. **Health Monitoring**: Monitor tunnel health and database connectivity
5. **Automatic Reconnection**: Reconnect on failures
6. **Cleanup**: Close tunnel when database disconnects

### Tunnel Status Monitoring

The tunnel manager provides comprehensive status information:

```javascript
// Available tunnel states
enum SSHTunnelStatus {
 'connecting', // Establishing SSH connection
 'connected', // Tunnel active and healthy
 'disconnected', // Tunnel closed normally
 'error' // Tunnel failed with error
}
```

### Multiple Database Tunnels

Configure multiple tunnels simultaneously:

```ini
[database.prod_db1]
type=postgresql
host=db1.internal.net
port=5432
database=app1
username=readonly1
password=pass1
ssh_host=bastion.company.com
ssh_username=tunnel_user
ssh_private_key=/path/to/key

[database.prod_db2]
type=mysql
host=db2.internal.net
port=3306
database=app2
username=readonly2
password=pass2
ssh_host=bastion.company.com
ssh_username=tunnel_user
ssh_private_key=/path/to/key
```

Each tunnel gets its own local port and SSH connection.

## Cloud Provider Examples

### AWS RDS with Bastion Host

```ini
[database.aws_rds_tunnel]
type=postgresql
host=prod-db.xyz.us-west-2.rds.amazonaws.com
port=5432
database=production
username=readonly_user
password=rds_password
ssl=true
select_only=true

# SSH through EC2 bastion host
ssh_host=bastion.company.com
ssh_username=ec2-user
ssh_private_key=/path/to/aws-key.pem
```

### Azure Database with Jump Server

```ini
[database.azure_tunnel]
type=mssql
host=myserver.database.windows.net
port=1433
database=production_db
username=azure_user
password=azure_password
encrypt=true

# SSH through Azure VM
ssh_host=jump-server.eastus.cloudapp.azure.com
ssh_username=azureuser
ssh_private_key=/path/to/azure-key
```

### Google Cloud SQL with Bastion

```ini
[database.gcp_tunnel]
type=mysql
host=10.x.x.x # Private IP
port=3306
database=gcp_app
username=mysql_user
password=gcp_password

# SSH through Compute Engine instance
ssh_host=bastion.zone.c.project-id.compute.internal
ssh_username=service_account
ssh_private_key=/path/to/gcp-key
```

## Security Best Practices

### SSH Server Hardening

```bash
# /etc/ssh/sshd_config recommendations
Port 22
Protocol 2
PermitRootLogin no
PubkeyAuthentication yes
PasswordAuthentication no
PermitEmptyPasswords no
MaxAuthTries 3
ClientAliveInterval 300
ClientAliveCountMax 2
```

### Key Security

```bash
# Secure key file permissions
chmod 600 ~/.ssh/private_key
chmod 644 ~/.ssh/private_key.pub
chmod 700 ~/.ssh

# Use strong passphrases
ssh-keygen -p -f ~/.ssh/private_key
```

### Network Security

- Use dedicated tunnel users with minimal privileges
- Restrict SSH access by source IP when possible
- Monitor SSH logs for unusual activity
- Rotate SSH keys regularly
- Use SSH certificates for large deployments

### Database Security

Even with SSH tunnels, maintain database security:
- Use read-only database accounts
- Apply principle of least privilege
- Enable database audit logging
- Use SSL/TLS for database connections
- Regularly review access patterns

## Monitoring and Logging

### SSH Tunnel Logs

The tunnel manager provides detailed logging:

```
2024-08-12 10:00:00 [INFO] Creating SSH tunnel for 'production_db'
2024-08-12 10:00:01 [DEBUG] SSH connection established for 'production_db'
2024-08-12 10:00:01 [INFO] SSH tunnel established for 'production_db' (local: 127.0.0.1:52341 -> remote: db.internal.net:5432)
2024-08-12 10:00:05 [DEBUG] Local connection received for tunnel 'production_db', creating forward
```

### Health Monitoring

Monitor tunnel health:
- Connection status
- Reconnection attempts
- Error rates
- Data transfer statistics
- Tunnel lifetime metrics

### Server-Side Monitoring

On SSH servers, monitor:
- SSH connection logs: `/var/log/auth.log`
- Failed authentication attempts
- Active tunnel connections: `ss -tuln`
- Resource usage by tunnel processes

## Troubleshooting

### Common SSH Issues

#### Connection Refused
```
Error: SSH connection failed: connect ECONNREFUSED
```

**Solutions:**
- Verify SSH server is running: `systemctl status sshd`
- Check firewall rules
- Verify correct hostname/IP and port
- Test direct SSH connection: `ssh user@host`

#### Authentication Failed
```
Error: SSH connection failed: All configured authentication methods failed
```

**Solutions:**
- Verify username is correct
- Check private key permissions: `chmod 600 key_file`
- Verify public key is in `~/.ssh/authorized_keys`
- Test key authentication: `ssh -i key_file user@host`

#### Key Format Issues
```
Error: Failed to read SSH private key
```

**Solutions:**
- Verify key file exists and is readable
- Check key format (OpenSSH vs PEM)
- Try regenerating key: `ssh-keygen -p -m RFC4716 -f key_file`
- Verify key isn't corrupted

#### Tunnel Port Conflicts
```
Error: SSH tunnel server failed: EADDRINUSE
```

**Solutions:**
- Wait for automatic port reassignment
- Restart MCP server to clear ports
- Check for other processes using ports: `netstat -tuln`

### Network Connectivity Issues

#### DNS Resolution
```
Error: getaddrinfo ENOTFOUND hostname
```

**Solutions:**
- Verify hostname resolves: `nslookup hostname`
- Try IP address instead of hostname
- Check DNS configuration
- Verify network connectivity

#### Firewall Blocking
```
Error: Connection timeout
```

**Solutions:**
- Check local firewall rules
- Verify intermediate firewall configuration
- Test with telnet: `telnet ssh_host ssh_port`
- Check cloud provider security groups

#### SSL/Database Connection Issues
```
Error: Database connection failed through tunnel
```

**Solutions:**
- Verify database server is reachable from SSH server
- Check database server firewall rules
- Test connection from SSH server: `telnet db_host db_port`
- Review database authentication settings

### Performance Issues

#### Slow Tunnel Setup
- Check SSH server load and resources
- Verify network latency between servers
- Consider SSH connection multiplexing
- Monitor SSH key authentication time

#### High Latency
- Measure network latency: `ping ssh_host`
- Check SSH server performance
- Consider geographic proximity
- Monitor tunnel data transfer rates

#### Connection Drops
- Review SSH keepalive settings
- Check network stability
- Monitor SSH server logs
- Verify tunnel monitoring configuration

## Advanced Features

### Connection Multiplexing

For multiple databases through same SSH server:

```bash
# SSH client config (~/.ssh/config)
Host bastion.company.com
 ControlMaster auto
 ControlPath ~/.ssh/control:%h:%p:%r
 ControlPersist 600
```

### SSH Config File Integration

Use SSH config files for complex setups:

```bash
# ~/.ssh/config
Host production-tunnel
 HostName bastion.company.com
 Port 22
 User tunnel_user
 IdentityFile ~/.ssh/production_key
 IdentitiesOnly yes
 ConnectTimeout 30
```

Then reference in configuration:
```ini
ssh_host=production-tunnel # Uses SSH config
```

### Custom SSH Options

The tunnel manager automatically sets optimal SSH options:
- `readyTimeout: 30000` - Connection timeout
- `keepaliveInterval: 60000` - Keepalive frequency
- Connection compression enabled
- TCP keepalive enabled

## Integration Examples

### Development Environment

```ini
# Local development with SSH tunnel to staging
[database.staging_dev]
type=postgresql
host=staging-db.internal.company.com
port=5432
database=staging_app
username=developer
password=dev_password
ssl=true

# SSH tunnel through development bastion
ssh_host=dev-bastion.company.com
ssh_username=developer
ssh_private_key=~/.ssh/dev_key
```

### Production Multi-Database Setup

```ini
# Primary application database
[database.app_primary]
type=postgresql
host=app-db-primary.internal.net
port=5432
database=production_app
username=app_readonly
password=${DB_APP_PASSWORD}
ssl=true
select_only=true
ssh_host=prod-bastion.company.com
ssh_username=tunnel_service
ssh_private_key=/opt/keys/production_tunnel_key

# Analytics database
[database.analytics]
type=mysql
host=analytics-db.internal.net
port=3306
database=analytics
username=analytics_readonly
password=${DB_ANALYTICS_PASSWORD}
ssl=true
select_only=true
ssh_host=prod-bastion.company.com
ssh_username=tunnel_service
ssh_private_key=/opt/keys/production_tunnel_key

# Reporting database
[database.reporting]
type=mssql
host=reporting-db.internal.net
port=1433
database=reporting
username=reporting_user
password=${DB_REPORTING_PASSWORD}
encrypt=true
select_only=true
ssh_host=prod-bastion.company.com
ssh_username=tunnel_service
ssh_private_key=/opt/keys/production_tunnel_key
```

### Cross-Cloud Connectivity

```ini
# AWS RDS through Azure VM bastion
[database.cross_cloud]
type=postgresql
host=prod-db.xyz.us-west-2.rds.amazonaws.com
port=5432
database=cross_cloud_app
username=readonly_user
password=aws_password
ssl=true
select_only=true

# SSH through Azure VM with VPN to AWS
ssh_host=vpn-gateway.eastus.cloudapp.azure.com
ssh_username=tunnel_user
ssh_private_key=/path/to/cross-cloud-key
```

## Automation and Orchestration

### Credentials in config.ini

The configuration file is read literally. There is no environment-variable
interpolation, so `password=${DB_PASSWORD}` is taken as a password whose value
is the eleven characters `${DB_PASSWORD}`, and the connection fails with an
authentication error that gives no hint why.

Put the real values in the file and protect the file instead:

```ini
[database.production]
type=mysql
host=mysql.internal.net
database=production
username=readonly
password=the-actual-password
ssh_host=bastion.company.com
ssh_username=service_account
ssh_private_key=/secure/path/tunnel_key
ssh_passphrase=the-actual-passphrase
```

```bash
chmod 600 config.ini            # the server warns on startup if it is not
chmod 600 /secure/path/tunnel_key   # and refuses a key file others can read
```

If your secrets live in a manager, write the file at deploy time from that
manager rather than expecting the server to expand references at read time.

### Containers

A container only helps if the MCP client runs inside it as well. The client
starts the server as a child process over stdio, so an image that runs the
server on its own has nothing talking to it and exits immediately.

Where the client is containerised, add the key and the configuration to that
image:

```dockerfile
FROM node:22-alpine

COPY --chown=node:node tunnel_key /home/node/.ssh/tunnel_key
RUN chmod 700 /home/node/.ssh && chmod 600 /home/node/.ssh/tunnel_key

COPY --chown=node:node . /app
WORKDIR /app
USER node
```

Point `ssh_private_key` at the path inside the image. The permission check runs
on the file as the container sees it, so a key baked in world-readable is
refused there just as it would be on a host.

There is no Kubernetes deployment for this. A `Deployment` expects a process
that stays up; this one exits with the session that started it, so it would
restart in a loop without ever being used.

## Performance Optimization

### Connection Pooling

The tunnel manager optimizes performance through:
- Connection reuse across database queries
- Lazy tunnel creation (only when needed)
- Automatic cleanup of idle tunnels
- Efficient port management

### Network Optimization

```bash
# SSH server optimizations
echo "TCPKeepAlive yes" >> /etc/ssh/sshd_config
echo "ClientAliveInterval 60" >> /etc/ssh/sshd_config
echo "ClientAliveCountMax 3" >> /etc/ssh/sshd_config
echo "Compression yes" >> /etc/ssh/sshd_config

# Restart SSH service
systemctl restart sshd
```

### Monitoring Performance

Track tunnel performance:
- Connection establishment time
- Data transfer rates
- Tunnel reliability metrics
- Resource usage per tunnel

## Best Practices Summary

### Security
- Use key-based authentication
- Disable SSH password authentication
- Use strong passphrases for keys
- Restrict SSH user permissions
- Monitor SSH access logs
- Rotate keys regularly

### Performance
- Use connection multiplexing when possible
- Monitor tunnel health and reconnections
- Optimize SSH server configuration
- Consider geographic proximity
- Use appropriate timeout values

### Reliability
- Test SSH connectivity independently
- Implement proper error handling
- Monitor tunnel status
- Use automatic reconnection
- Have backup connectivity methods

### Operations
- Document tunnel configurations
- Use environment variables for secrets
- Implement proper logging
- Monitor resource usage
- Plan for disaster recovery

## Conclusion

SSH tunneling provides a robust, secure method for connecting to databases through the Argos. The built-in tunnel manager handles the complexity of SSH connections, port forwarding, and health monitoring while providing enterprise-grade reliability and security.

Key benefits:
- **Transparent Integration** - Works seamlessly with all database types
- **Automatic Management** - Handles connection lifecycle and recovery
- **Enterprise Security** - Supports key-based authentication and monitoring
- **High Performance** - Optimized for connection pooling and reuse
- **Cloud Ready** - Works with all major cloud providers and architectures

For additional help:
- [Security Guide](../guides/security-guide.md)
- [Configuration Guide](../guides/configuration-guide.md)
- [Troubleshooting Guide](../guides/troubleshooting-guide.md)
- [OpenSSH Documentation](https://www.openssh.com/manual.html)
