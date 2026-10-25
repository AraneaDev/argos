-- MySQL Demo Database Initialization Script
-- This script creates sample tables and data for testing Argos

-- Create users table
CREATE TABLE users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    is_active BOOLEAN DEFAULT TRUE,
    department VARCHAR(50)
);

-- Create categories table
CREATE TABLE categories (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create products table
CREATE TABLE products (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    price DECIMAL(10,2) NOT NULL,
    category_id INT,
    stock_quantity INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    is_active BOOLEAN DEFAULT TRUE,
    FOREIGN KEY (category_id) REFERENCES categories(id)
);

-- Create orders table
CREATE TABLE orders (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT,
    product_name VARCHAR(255) NOT NULL,
    quantity INT NOT NULL DEFAULT 1,
    price DECIMAL(10,2) NOT NULL,
    order_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    status VARCHAR(20) DEFAULT 'pending',
    FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Insert sample categories
INSERT INTO categories (name, description) VALUES
('Electronics', 'Electronic devices and gadgets'),
('Books', 'Physical and digital books'),
('Clothing', 'Apparel and accessories'),
('Home & Garden', 'Home improvement and garden supplies'),
('Sports', 'Sports equipment and accessories');

-- Insert sample products
INSERT INTO products (name, description, price, category_id, stock_quantity) VALUES
('Laptop Pro 15"', 'High-performance laptop for professionals', 1299.99, 1, 25),
('Wireless Headphones', 'Noise-cancelling wireless headphones', 199.99, 1, 50),
('Programming Guide', 'Comprehensive guide to modern programming', 39.99, 2, 100),
('T-Shirt Classic', 'Comfortable cotton t-shirt', 19.99, 3, 200),
('Running Shoes', 'Professional running shoes', 89.99, 5, 75),
('Garden Tools Set', 'Complete set of garden tools', 59.99, 4, 30),
('Smartphone 12', 'Latest model smartphone', 699.99, 1, 40),
('Science Fiction Novel', 'Award-winning science fiction book', 14.99, 2, 150),
('Winter Jacket', 'Warm winter jacket', 129.99, 3, 60),
('Tennis Racket', 'Professional tennis racket', 79.99, 5, 35);

-- Insert sample users
INSERT INTO users (name, email, department) VALUES
('John Smith', 'john.smith@example.com', 'Engineering'),
('Sarah Johnson', 'sarah.johnson@example.com', 'Marketing'),
('Michael Brown', 'michael.brown@example.com', 'Sales'),
('Emily Davis', 'emily.davis@example.com', 'HR'),
('David Wilson', 'david.wilson@example.com', 'Engineering'),
('Lisa Anderson', 'lisa.anderson@example.com', 'Finance'),
('Robert Taylor', 'robert.taylor@example.com', 'Sales'),
('Jennifer Martinez', 'jennifer.martinez@example.com', 'Marketing'),
('William Garcia', 'william.garcia@example.com', 'Operations'),
('Ashley Miller', 'ashley.miller@example.com', 'HR');

-- Insert sample orders
INSERT INTO orders (user_id, product_name, quantity, price, status) VALUES
(1, 'Laptop Pro 15"', 1, 1299.99, 'completed'),
(2, 'Wireless Headphones', 2, 199.99, 'completed'),
(3, 'T-Shirt Classic', 3, 19.99, 'shipped'),
(4, 'Programming Guide', 1, 39.99, 'completed'),
(5, 'Running Shoes', 1, 89.99, 'pending'),
(1, 'Smartphone 12', 1, 699.99, 'shipped'),
(6, 'Garden Tools Set', 1, 59.99, 'completed'),
(7, 'Tennis Racket', 1, 79.99, 'completed'),
(8, 'Winter Jacket', 2, 129.99, 'shipped'),
(9, 'Science Fiction Novel', 1, 14.99, 'completed'),
(10, 'Wireless Headphones', 1, 199.99, 'pending'),
(2, 'Programming Guide', 2, 39.99, 'completed'),
(3, 'Running Shoes', 1, 89.99, 'shipped'),
(4, 'T-Shirt Classic', 5, 19.99, 'completed'),
(5, 'Laptop Pro 15"', 1, 1299.99, 'pending');

-- Create a view for order summaries
CREATE VIEW order_summary AS
SELECT 
    u.name as customer_name,
    u.email,
    u.department,
    COUNT(o.id) as total_orders,
    SUM(o.price * o.quantity) as total_spent,
    AVG(o.price * o.quantity) as avg_order_value,
    MAX(o.order_date) as last_order_date
FROM users u
LEFT JOIN orders o ON u.id = o.user_id
GROUP BY u.id, u.name, u.email, u.department;

-- Create indexes for better performance
CREATE INDEX idx_orders_user_id ON orders(user_id);
CREATE INDEX idx_orders_order_date ON orders(order_date);
CREATE INDEX idx_products_category_id ON products(category_id);
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_department ON users(department);

-- Add a stored procedure for demonstration (MySQL specific)
DELIMITER $$
CREATE PROCEDURE GetUserOrderCount(IN user_id_param INT, OUT order_count INT)
BEGIN
    SELECT COUNT(*) INTO order_count
    FROM orders 
    WHERE user_id = user_id_param;
END$$
DELIMITER ;

-- Create a function to calculate total spent by user
DELIMITER $$
CREATE FUNCTION CalculateUserTotal(user_id_param INT) 
RETURNS DECIMAL(10,2) 
READS SQL DATA
DETERMINISTIC
BEGIN
    DECLARE total DECIMAL(10,2) DEFAULT 0;
    
    SELECT COALESCE(SUM(price * quantity), 0) INTO total
    FROM orders 
    WHERE user_id = user_id_param;
    
    RETURN total;
END$$
DELIMITER ;

-- Create a view showing top customers
CREATE VIEW top_customers AS
SELECT 
    u.id,
    u.name,
    u.email,
    u.department,
    COUNT(o.id) as order_count,
    SUM(o.price * o.quantity) as total_spent
FROM users u
JOIN orders o ON u.id = o.user_id
GROUP BY u.id, u.name, u.email, u.department
HAVING total_spent > 100
ORDER BY total_spent DESC;

-- Grant permissions (uncomment and adjust as needed)
-- GRANT SELECT ON demo_db.* TO 'demo_user'@'%';
-- GRANT EXECUTE ON demo_db.* TO 'demo_user'@'%';