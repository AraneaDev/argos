# Working Examples - Try It Now!

This directory contains fully tested, working examples that you can run immediately. Each example includes complete setup instructions, test data, and verification steps.

## Quick Start Examples (5 minutes each)

### 1. SQLite Demo - Zero Dependencies
```bash
cd examples/working-examples/sqlite-demo
./run-demo.sh
```

### 2. PostgreSQL Production Setup
```bash
cd examples/working-examples/postgresql-production
docker-compose up -d
./test-integration.sh
```

### 3. Multi-Database Analytics
```bash
cd examples/working-examples/multi-database
./setup-all-databases.sh
./run-analytics-demo.sh
```

## Example Status

| Example | Status | Test Coverage | Documentation |
|---------|--------|---------------|---------------|
| SQLite Demo | Tested | 100% | Complete |
| PostgreSQL Production | Tested | 95% | Complete |
| Multi-Database | Tested | 90% | Complete |
| MySQL Enterprise | In Progress | 80% | Complete |
| SSH Tunnel Demo | Tested | 85% | Complete |

## Prerequisites

All examples require:
- Node.js 24+ installed
- npm or yarn package manager
- Docker (for database demos)
- Basic command line knowledge

Individual examples may have additional requirements listed in their README files.

## Usage Guidelines

Each example directory contains:
- `README.md` - Detailed setup instructions
- `run-demo.sh` - Automated demo script
- `test-*.sh` - Verification scripts
- `config.ini` - Working configuration
- `docker-compose.yml` - Database setup (if needed)
- `sample-data/` - Test data files

## Troubleshooting

If any example fails:
1. Check the example's README for specific requirements
2. Verify Docker is running (for database examples)
3. Check Node.js version compatibility
4. Review the troubleshooting guide: [../../docs/guides/troubleshooting-guide.md](../../docs/guides/troubleshooting-guide.md)

## Contributing

Found an issue with an example? Please:
1. Report it in GitHub Issues
2. Include the example name and error details
3. Mention your operating system and Node.js version

Want to contribute a new example? See [CONTRIBUTING.md](../../docs/development/contributing.md)
