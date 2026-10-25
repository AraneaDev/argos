#!/bin/bash
# Setup SQLite demo database and configuration

set -e

echo "[DATA] Creating SQLite demo database..."

# Remove existing database if it exists
if [ -f "demo.db" ]; then
    rm demo.db
    echo "   Removed existing demo.db"
fi

# Create database with schema and sample data
sqlite3 demo.db << 'EOF'
-- Demo database schema with sample data

-- Create departments table
CREATE TABLE departments (
    id INTEGER PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,
    description TEXT
);

-- Create users table
CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    department_id INTEGER,
    role TEXT,
    is_active BOOLEAN DEFAULT 1,
    salary DECIMAL(10,2),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (department_id) REFERENCES departments (id)
);

-- Create orders table
CREATE TABLE orders (
    id INTEGER PRIMARY KEY,
    user_id INTEGER,
    order_number TEXT UNIQUE NOT NULL,
    product_name TEXT NOT NULL,
    amount DECIMAL(10,2) NOT NULL,
    quantity INTEGER DEFAULT 1,
    status TEXT DEFAULT 'pending',
    order_date DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users (id)
);

-- Insert departments
INSERT INTO departments (name, description) VALUES
('Engineering', 'Software development and technical operations'),
('Marketing', 'Marketing and brand management'),
('Sales', 'Sales and customer relations'),
('Support', 'Customer support and success'),
('HR', 'Human resources and administration');

-- Insert users with realistic data
INSERT INTO users (name, email, department_id, role, salary) VALUES
('John Doe', 'john.doe@company.com', 1, 'Senior Developer', 95000.00),
('Jane Smith', 'jane.smith@company.com', 2, 'Marketing Manager', 78000.00),
('Bob Wilson', 'bob.wilson@company.com', 3, 'Sales Representative', 65000.00),
('Alice Brown', 'alice.brown@company.com', 1, 'Engineering Lead', 115000.00),
('Charlie Davis', 'charlie.davis@company.com', 4, 'Support Specialist', 52000.00),
('Diana Green', 'diana.green@company.com', 2, 'Content Creator', 58000.00),
('Frank Miller', 'frank.miller@company.com', 3, 'Sales Manager', 89000.00),
('Grace Lee', 'grace.lee@company.com', 1, 'DevOps Engineer', 88000.00);

-- Insert orders with variety
INSERT INTO orders (user_id, order_number, product_name, amount, quantity, status) VALUES
(1, 'ORD-2024-001', 'Laptop Pro 16"', 2299.99, 1, 'delivered'),
(1, 'ORD-2024-002', 'Wireless Mouse', 79.99, 2, 'delivered'),
(2, 'ORD-2024-003', 'Standing Desk', 599.99, 1, 'shipped'),
(3, 'ORD-2024-004', 'Monitor 27"', 389.99, 1, 'delivered'),
(4, 'ORD-2024-005', 'Mechanical Keyboard', 149.99, 1, 'delivered'),
(5, 'ORD-2024-006', 'Webcam HD', 129.99, 1, 'processing'),
(2, 'ORD-2024-007', 'Desk Chair', 449.99, 1, 'delivered'),
(3, 'ORD-2024-008', 'Phone Stand', 29.99, 3, 'shipped'),
(6, 'ORD-2024-009', 'Tablet Pro', 799.99, 1, 'pending'),
(7, 'ORD-2024-010', 'Bluetooth Headphones', 199.99, 1, 'delivered'),
(8, 'ORD-2024-011', 'External SSD 1TB', 159.99, 2, 'processing'),
(4, 'ORD-2024-012', 'USB-C Hub', 89.99, 1, 'delivered');

-- Create useful views for analytics
CREATE VIEW user_department_summary AS
SELECT 
    d.name as department,
    COUNT(u.id) as user_count,
    AVG(u.salary) as avg_salary,
    SUM(u.salary) as total_salary
FROM departments d
LEFT JOIN users u ON d.id = u.department_id AND u.is_active = 1
GROUP BY d.id, d.name;

CREATE VIEW order_analytics AS
SELECT 
    u.name as customer_name,
    d.name as department,
    o.order_number,
    o.product_name,
    o.amount,
    o.status,
    o.order_date
FROM orders o
JOIN users u ON o.user_id = u.id
JOIN departments d ON u.department_id = d.id
ORDER BY o.order_date DESC;

-- Create indexes for performance
CREATE INDEX idx_users_department ON users(department_id);
CREATE INDEX idx_orders_user ON orders(user_id);
CREATE INDEX idx_orders_date ON orders(order_date);
CREATE INDEX idx_users_email ON users(email);

EOF

# Verify database was created successfully
USER_COUNT=$(sqlite3 demo.db "SELECT COUNT(*) FROM users;")
ORDER_COUNT=$(sqlite3 demo.db "SELECT COUNT(*) FROM orders;")
DEPT_COUNT=$(sqlite3 demo.db "SELECT COUNT(*) FROM departments;")

echo "[OK] Database created successfully:"
echo "   $DEPT_COUNT departments"
echo "   $USER_COUNT users"
echo "   $ORDER_COUNT orders"

# Create configuration file
echo "[NOTE] Creating configuration file..."
cat > config.ini << 'EOF'
# SQLite Demo Configuration
[database.demo]
type=sqlite
file=./demo.db
select_only=false
timeout=10000

[security]
max_joins=10
max_subqueries=5
max_unions=3
max_group_bys=5
max_complexity_score=100
max_query_length=10000

[extension]
max_rows=1000
query_timeout=30000
max_batch_size=10
debug=true
EOF

echo "[OK] Configuration created: config.ini"

# Create the Claude Code registration command for this demo
echo "[CONFIG] Writing the Claude Code registration command..."
REPO_ROOT=$(cd "$(dirname "$0")/../../.." && pwd)
cat > register-with-claude.sh << EOF
#!/bin/sh
# Registers this SQLite demo with Claude Code as "argos-demo".
# Remove it again with: claude mcp remove argos-demo
set -eu
claude mcp add argos-demo -- \\
  node "$REPO_ROOT/dist/cli.js" serve --config "$(pwd)/config.ini"
EOF
chmod +x register-with-claude.sh

echo "[OK] Registration script created: register-with-claude.sh"
echo "   Run it, then confirm with: claude mcp list"

# Create sample queries file
echo "[INFO] Creating sample queries..."
cat > sample-queries.sql << 'EOF'
-- Sample queries for SQLite demo

-- 1. Basic user count
SELECT COUNT(*) as total_users FROM users;

-- 2. Users by department
SELECT 
    d.name as department,
    COUNT(u.id) as user_count,
    AVG(u.salary) as avg_salary
FROM departments d
LEFT JOIN users u ON d.id = u.department_id
GROUP BY d.name
ORDER BY user_count DESC;

-- 3. Recent orders with customer info
SELECT 
    u.name as customer,
    o.order_number,
    o.product_name,
    o.amount,
    o.status,
    DATE(o.order_date) as order_date
FROM orders o
JOIN users u ON o.user_id = u.id
ORDER BY o.order_date DESC
LIMIT 10;

-- 4. Department sales summary
SELECT 
    d.name as department,
    COUNT(o.id) as order_count,
    SUM(o.amount) as total_sales,
    AVG(o.amount) as avg_order_value
FROM departments d
JOIN users u ON d.id = u.department_id
JOIN orders o ON u.id = o.user_id
GROUP BY d.name
ORDER BY total_sales DESC;

-- 5. Top spending customers
SELECT 
    u.name,
    u.email,
    d.name as department,
    COUNT(o.id) as order_count,
    SUM(o.amount) as total_spent
FROM users u
JOIN departments d ON u.department_id = d.id
LEFT JOIN orders o ON u.id = o.user_id
GROUP BY u.id
ORDER BY total_spent DESC;
EOF

echo "[OK] Sample queries created: sample-queries.sql"

echo "[FILES] Demo setup complete! Files created:"
echo "   - demo.db (SQLite database)"
echo "   - config.ini (MCP server config)"
echo "   - register-with-claude.sh (Claude Code registration)"
echo "   - sample-queries.sql (Test queries)"
