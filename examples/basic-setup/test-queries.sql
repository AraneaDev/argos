-- Sample Test Queries for Argos
-- Use these queries to test your database connections and functionality

-- =============================================================================
-- Basic Connection Tests
-- =============================================================================

-- Test 1: Show available tables (works on all database types)
-- PostgreSQL/MySQL version:
SELECT table_name, table_type 
FROM information_schema.tables 
WHERE table_schema = 'public' OR table_schema = DATABASE()
ORDER BY table_name;

-- SQLite version:
SELECT name as table_name, type as table_type 
FROM sqlite_master 
WHERE type IN ('table', 'view')
ORDER BY name;

-- Test 2: Show database version
-- PostgreSQL:
SELECT version();

-- MySQL:
SELECT VERSION();

-- SQLite:
SELECT sqlite_version();

-- =============================================================================
-- Schema Exploration Queries
-- =============================================================================

-- Test 3: List all columns in a specific table (replace 'your_table_name')
-- PostgreSQL:
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns 
WHERE table_name = 'your_table_name'
ORDER BY ordinal_position;

-- MySQL:
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns 
WHERE table_name = 'your_table_name' AND table_schema = DATABASE()
ORDER BY ordinal_position;

-- SQLite:
PRAGMA table_info(your_table_name);

-- Test 4: Show table sizes (approximate)
-- PostgreSQL:
SELECT 
    tablename,
    pg_size_pretty(pg_total_relation_size(tablename::regclass)) as size
FROM pg_tables 
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size(tablename::regclass) DESC;

-- MySQL:
SELECT 
    table_name,
    ROUND(((data_length + index_length) / 1024 / 1024), 2) as size_mb
FROM information_schema.tables 
WHERE table_schema = DATABASE()
ORDER BY (data_length + index_length) DESC;

-- =============================================================================
-- Sample Data Queries (if you have test data)
-- =============================================================================

-- Test 5: Count rows in each table
-- For PostgreSQL/MySQL (replace with your actual table names):
SELECT 
    'users' as table_name, 
    COUNT(*) as row_count 
FROM users
UNION ALL
SELECT 
    'orders' as table_name, 
    COUNT(*) as row_count 
FROM orders;

-- Test 6: Sample data from a table (replace 'your_table_name')
SELECT * FROM your_table_name LIMIT 10;

-- =============================================================================
-- Security Testing (SELECT-only mode)
-- =============================================================================

-- Test 7: These should work in SELECT-only mode
SELECT 1 as test_number;
SELECT NOW() as current_time; -- PostgreSQL/MySQL
SELECT datetime('now') as current_time; -- SQLite

-- Test 8: These should be BLOCKED in SELECT-only mode
-- (Don't run these on production data!)
/*
INSERT INTO test_table (name) VALUES ('test');
UPDATE test_table SET name = 'updated' WHERE id = 1;
DELETE FROM test_table WHERE id = 1;
DROP TABLE test_table;
CREATE TABLE test_table (id INT);
*/

-- =============================================================================
-- Performance Testing
-- =============================================================================

-- Test 9: Simple JOIN test (if you have related tables)
/*
SELECT 
    u.id,
    u.name,
    COUNT(o.id) as order_count
FROM users u
LEFT JOIN orders o ON u.id = o.user_id
GROUP BY u.id, u.name
ORDER BY order_count DESC
LIMIT 20;
*/

-- Test 10: Complex query for testing security limits
/*
WITH recent_orders AS (
    SELECT user_id, COUNT(*) as order_count
    FROM orders 
    WHERE created_at > NOW() - INTERVAL '30 days'
    GROUP BY user_id
)
SELECT 
    u.name,
    ro.order_count,
    AVG(o.total) as avg_order_value
FROM users u
JOIN recent_orders ro ON u.id = ro.user_id
JOIN orders o ON u.id = o.user_id
WHERE ro.order_count > 5
GROUP BY u.name, ro.order_count
ORDER BY avg_order_value DESC;
*/

-- =============================================================================
-- Multi-Database Testing (if using multiple databases)
-- =============================================================================

-- Test 11: Compare data between databases
-- (Run these separately or use batch queries)
/*
-- Database 1:
SELECT 'database1' as source, COUNT(*) as user_count FROM users;

-- Database 2:  
SELECT 'database2' as source, COUNT(*) as user_count FROM users;
*/

-- =============================================================================
-- Claude Query Examples
-- =============================================================================

-- Instead of running these directly, ask Claude:
-- "Show me all the tables in my database"
-- "What's the schema of the users table?"
-- "Count the number of records in each table"
-- "Show me the first 10 rows from the most recently updated table"
-- "What are the column types in the orders table?"
-- "Find any tables that might contain user information"
-- "Show me a sample of data from each table"

-- =============================================================================
-- Troubleshooting Queries
-- =============================================================================

-- Test 12: Check current user and permissions
-- PostgreSQL:
SELECT current_user, session_user;

-- MySQL:
SELECT USER(), CURRENT_USER();

-- Test 13: Check connection info
-- PostgreSQL:
SELECT inet_client_addr(), inet_client_port();

-- MySQL:
SHOW PROCESSLIST;

-- =============================================================================
-- Notes
-- =============================================================================

-- Remember:
-- 1. Replace 'your_table_name' with actual table names from your database
-- 2. Uncommented queries are safe for SELECT-only mode
-- 3. Commented queries (/* */) may modify data or be blocked in SELECT-only mode
-- 4. Always test with non-production data first
-- 5. Use LIMIT clauses to prevent large result sets
-- 6. Check your security settings if complex queries fail