# Basic Queries Tutorial

This tutorial teaches you how to effectively use Claude with the Argos to query and analyze your databases.

## Overview

With Claude Code connected to your Argos, Claude can help you:

- **Execute SQL queries** safely with built-in security validation
- **Analyze data patterns** and generate business insights 
- **Create reports** with formatted results and visualizations
- **Troubleshoot database issues** and optimize queries
- **Learn SQL** through interactive examples and explanations

## Prerequisites

Before starting, ensure you have:

- **Argos installed** - [Installation Tutorial](01-installation.md)
- **Claude Code integrated** - [Claude Integration Tutorial](03-claude-integration.md)
- **Database connected** - At least one database configured and tested
- **Sample data** - Some data in your database to query

## Getting Started

### Verify Connection

Start by confirming Claude can access your databases:

**You:** "Can you see my databases? List them for me."

**Claude:** "I can see you have the following databases configured:
- **production** (PostgreSQL, SELECT-only mode) - 23 tables, 156 columns
- **analytics** (MySQL, SELECT-only mode) - 8 tables, 67 columns

Both databases are configured with SELECT-only access for security. Would you like me to explore the schema of either database?"

### Understanding Security Mode

The Argos operates in SELECT-only mode by default, which means:

- **Allowed**: SELECT, WITH, SHOW, EXPLAIN, DESCRIBE
- **Blocked**: INSERT, UPDATE, DELETE, DROP, CREATE, ALTER

This ensures safe, read-only access to your production data.

## Basic Query Operations

### 1. Exploring Database Schema

**Discover Tables:**
```
"Show me all tables in the production database"
```

**Claude will use `sql_get_schema` to retrieve a compact overview:**

For large databases (>200 columns), you'll see a summary listing:
```
production (postgresql) - 45T 8V 1247C
TABLES:
users(8c keys:[id,email])
user_profiles(6c keys:[id,user_id])
user_sessions(5c keys:[id,user_id])
posts(6c keys:[id,user_id])
comments(5c keys:[id,post_id,user_id])
categories(4c keys:[id,slug])
page_views(4c keys:[id])
user_actions(5c keys:[id,user_id])

Use sql_get_schema with table parameter to see full column details for a specific table.
```

**Examine Specific Table:**
```
"Show me the structure of the users table"
```

**Claude will call `sql_get_schema` with `table: "users"` for full column details:**
```
production (postgresql) - 45T 8V 1247C
users: id integer [PRI,NN,d:nextval], name varchar(255) [NN], email varchar(255) [PRI,NN], password_hash varchar(255) [NN], created_at timestamp [NN,d:now()], updated_at timestamp [NN,d:now()], is_active boolean [NN,d:true], role varchar(50) [NN,d:'user']
```

Column flags: `PRI`=primary key, `NN`=not null, `d:val`=default value, `MUL`=indexed.

### 2. Simple Data Queries

**Count Records:**
```
"How many users are in the database?"
```

**Claude executes and explains:**
```sql
SELECT COUNT(*) as total_users FROM users;
```
```
Your database contains **2,847 users** total.

This gives us a good sense of your user base size. Would you like me to break this down further, such as:
- Active vs inactive users
- Registration trends over time 
- Users by role or other attributes?
```

**Recent Data:**
```
"Show me the 10 most recent user registrations"
```

**Claude's response with formatted results:**
```sql
SELECT id, name, email, created_at 
FROM users 
ORDER BY created_at DESC 
LIMIT 10;
```

| ID | Name | Email | Created At |
|----|------|-------|------------|
| 2847 | Sarah Johnson | sarah.j@example.com | 2024-08-12 14:23:15 |
| 2846 | Mike Chen | mike.chen@example.com | 2024-08-12 13:45:32 |
| 2845 | Alex Rodriguez | alex.r@example.com | 2024-08-12 11:15:47 |
| ... | ... | ... | ... |

```
These are your most recent user registrations from today. I notice consistent signup activity throughout the day, which suggests healthy user acquisition.
```

### 3. Filtering and Searching

**Filter by Conditions:**
```
"Show me all users who registered in the last 30 days and are currently active"
```

**Claude's query and analysis:**
```sql
SELECT name, email, created_at, role
FROM users 
WHERE created_at >= CURRENT_DATE - INTERVAL '30 days'
 AND is_active = true
ORDER BY created_at DESC;
```

```
Found **234 active users** who registered in the last 30 days:

Recent Registration Summary:
- Last 7 days: 67 users 
- Last 14 days: 123 users
- Last 30 days: 234 users

This shows healthy growth with steady daily registrations. The 30-day retention rate appears strong since all these recent users are still active.
```

**Text Search:**
```
"Find users with 'gmail' in their email address"
```

```sql
SELECT name, email, created_at
FROM users 
WHERE email ILIKE '%gmail%'
ORDER BY created_at DESC
LIMIT 20;
```

**Pattern Matching:**
```
"Show me posts with titles containing 'tutorial' or 'guide'"
```

```sql
SELECT id, title, user_id, published_at
FROM posts 
WHERE title ILIKE '%tutorial%' 
 OR title ILIKE '%guide%'
ORDER BY published_at DESC;
```

### 4. Aggregation and Grouping

**Grouping Data:**
```
"Show me user registration counts by month for this year"
```

**Claude's analytical query:**
```sql
SELECT 
 DATE_TRUNC('month', created_at) as month,
 COUNT(*) as new_users
FROM users 
WHERE created_at >= DATE_TRUNC('year', CURRENT_DATE)
GROUP BY DATE_TRUNC('month', created_at)
ORDER BY month;
```

| Month | New Users |
|-------|-----------|
| 2024-01 | 187 |
| 2024-02 | 203 |
| 2024-03 | 245 |
| 2024-04 | 198 |
| 2024-05 | 267 |
| 2024-06 | 289 |
| 2024-07 | 312 |
| 2024-08 | 156 |

```
User registration trends show:
- **Growth trajectory**: Steady increase from 187 (Jan) to 312 (July)
- **Peak month**: July with 312 new registrations 
- **Current month**: 156 registrations so far in August
- **Average**: ~232 new users per month

The growth trend is very positive with a 67% increase from January to July.
```

**Statistical Analysis:**
```
"Calculate average, min, and max post lengths in characters"
```

```sql
SELECT 
 COUNT(*) as total_posts,
 ROUND(AVG(LENGTH(content))) as avg_length,
 MIN(LENGTH(content)) as min_length,
 MAX(LENGTH(content)) as max_length,
 ROUND(STDDEV(LENGTH(content))) as std_deviation
FROM posts 
WHERE content IS NOT NULL;
```

## Advanced Query Techniques

### 1. JOIN Operations

**Simple JOIN:**
```
"Show me the top 10 users by post count with their details"
```

**Claude's optimized query:**
```sql
SELECT 
 u.name,
 u.email,
 u.created_at as user_since,
 COUNT(p.id) as post_count,
 MAX(p.published_at) as latest_post
FROM users u
LEFT JOIN posts p ON u.id = p.user_id
GROUP BY u.id, u.name, u.email, u.created_at
ORDER BY post_count DESC, u.name
LIMIT 10;
```

**Complex JOINs:**
```
"Show me posts with their authors and comment counts"
```

```sql
SELECT 
 p.id,
 p.title,
 u.name as author,
 p.published_at,
 COUNT(c.id) as comment_count,
 CASE 
 WHEN COUNT(c.id) > 20 THEN 'Highly Discussed'
 WHEN COUNT(c.id) > 5 THEN 'Active Discussion' 
 WHEN COUNT(c.id) > 0 THEN 'Some Comments'
 ELSE 'No Comments Yet'
 END as engagement_level
FROM posts p
JOIN users u ON p.user_id = u.id
LEFT JOIN comments c ON p.id = c.post_id
GROUP BY p.id, p.title, u.name, p.published_at
ORDER BY comment_count DESC, p.published_at DESC
LIMIT 15;
```

### 2. Subqueries and CTEs

**Subquery Example:**
```
"Find users who have posted more than the average number of posts"
```

```sql
WITH user_post_counts AS (
 SELECT 
 u.id,
 u.name,
 u.email,
 COUNT(p.id) as post_count
 FROM users u
 LEFT JOIN posts p ON u.id = p.user_id
 GROUP BY u.id, u.name, u.email
),
average_posts AS (
 SELECT AVG(post_count) as avg_posts
 FROM user_post_counts
)
SELECT 
 upc.name,
 upc.email,
 upc.post_count,
 ROUND(ap.avg_posts, 1) as average_posts,
 ROUND(upc.post_count::numeric / ap.avg_posts, 2) as above_average_ratio
FROM user_post_counts upc, average_posts ap
WHERE upc.post_count > ap.avg_posts
ORDER BY upc.post_count DESC;
```

**Window Functions:**
```
"Show me user ranking by post count with percentiles"
```

```sql
SELECT 
 u.name,
 COUNT(p.id) as post_count,
 ROW_NUMBER() OVER (ORDER BY COUNT(p.id) DESC) as rank,
 ROUND(PERCENT_RANK() OVER (ORDER BY COUNT(p.id)) * 100, 1) as percentile,
 NTILE(10) OVER (ORDER BY COUNT(p.id)) as decile
FROM users u
LEFT JOIN posts p ON u.id = p.user_id
GROUP BY u.id, u.name
HAVING COUNT(p.id) > 0
ORDER BY post_count DESC
LIMIT 20;
```

### 3. Date and Time Analysis

**Time-based Analysis:**
```
"Analyze posting activity by hour of day to find peak usage times"
```

```sql
SELECT 
 EXTRACT(HOUR FROM published_at) as hour_of_day,
 COUNT(*) as post_count,
 ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER(), 2) as percentage
FROM posts 
WHERE published_at >= CURRENT_DATE - INTERVAL '30 days'
GROUP BY EXTRACT(HOUR FROM published_at)
ORDER BY hour_of_day;
```

**Cohort Analysis:**
```
"Analyze user retention by registration month"
```

```sql
WITH user_cohorts AS (
 SELECT 
 u.id,
 DATE_TRUNC('month', u.created_at) as cohort_month,
 u.created_at
 FROM users u
),
user_activity AS (
 SELECT 
 uc.cohort_month,
 uc.id as user_id,
 DATE_TRUNC('month', p.published_at) as activity_month
 FROM user_cohorts uc
 LEFT JOIN posts p ON uc.id = p.user_id
 WHERE p.published_at IS NOT NULL
)
SELECT 
 cohort_month,
 COUNT(DISTINCT user_id) as cohort_size,
 COUNT(DISTINCT CASE WHEN activity_month = cohort_month THEN user_id END) as active_month_0,
 COUNT(DISTINCT CASE WHEN activity_month = cohort_month + INTERVAL '1 month' THEN user_id END) as active_month_1,
 COUNT(DISTINCT CASE WHEN activity_month = cohort_month + INTERVAL '2 months' THEN user_id END) as active_month_2
FROM user_activity
GROUP BY cohort_month
ORDER BY cohort_month;
```

## Data Analysis and Insights

### 1. Business Intelligence Queries

**Content Performance:**
```
"What are our top-performing content categories by engagement?"
```

**Claude's comprehensive analysis:**
```sql
WITH category_performance AS (
 SELECT 
 cat.name as category,
 COUNT(DISTINCT p.id) as post_count,
 COUNT(DISTINCT c.id) as total_comments,
 COUNT(DISTINCT pv.id) as total_views,
 ROUND(AVG(LENGTH(p.content))) as avg_content_length,
 MAX(p.published_at) as latest_post
 FROM categories cat
 JOIN posts p ON cat.id = p.category_id
 LEFT JOIN comments c ON p.id = c.post_id
 LEFT JOIN page_views pv ON pv.page_url LIKE '%/posts/' || p.id || '%'
 GROUP BY cat.id, cat.name
)
SELECT 
 category,
 post_count,
 total_comments,
 total_views,
 ROUND(total_comments::numeric / NULLIF(post_count, 0), 2) as comments_per_post,
 ROUND(total_views::numeric / NULLIF(post_count, 0), 2) as views_per_post,
 CASE 
 WHEN total_views > 1000 AND total_comments > 100 THEN 'High Engagement'
 WHEN total_views > 500 OR total_comments > 50 THEN 'Medium Engagement'
 ELSE 'Low Engagement'
 END as engagement_category
FROM category_performance
ORDER BY total_views DESC, total_comments DESC;
```

### 2. Trend Analysis

**Growth Metrics:**
```
"Show me month-over-month growth in user activity"
```

```sql
WITH monthly_metrics AS (
 SELECT 
 DATE_TRUNC('month', created_at) as month,
 COUNT(DISTINCT id) as new_users,
 COUNT(DISTINCT CASE WHEN is_active THEN id END) as active_users
 FROM users
 WHERE created_at >= CURRENT_DATE - INTERVAL '12 months'
 GROUP BY DATE_TRUNC('month', created_at)
)
SELECT 
 month,
 new_users,
 active_users,
 LAG(new_users) OVER (ORDER BY month) as prev_month_users,
 ROUND(
 (new_users - LAG(new_users) OVER (ORDER BY month))::numeric / 
 NULLIF(LAG(new_users) OVER (ORDER BY month), 0) * 100, 
 2
 ) as user_growth_rate
FROM monthly_metrics
ORDER BY month;
```

## Query Optimization

### Understanding Query Performance

**Check Query Execution Plan:**
```
"Can you show me the execution plan for finding active users?"
```

**Claude will use EXPLAIN:**
```sql
EXPLAIN ANALYZE 
SELECT name, email, created_at 
FROM users 
WHERE is_active = true 
 AND created_at >= CURRENT_DATE - INTERVAL '30 days'
ORDER BY created_at DESC;
```

**Identify Slow Queries:**
```
"Help me optimize this query that's running slowly"
```

**Claude's optimization approach:**
1. **Analyze the current query structure**
2. **Suggest index improvements**
3. **Recommend query rewrites**
4. **Explain performance implications**

### Best Practices

**Efficient Filtering:**
```sql
-- Good: Use indexed columns in WHERE clauses
SELECT * FROM users WHERE email = 'user@example.com';

-- Avoid: Functions on indexed columns
SELECT * FROM users WHERE UPPER(email) = 'USER@EXAMPLE.COM';
```

**Optimal JOINs:**
```sql
-- Good: JOIN on indexed foreign keys
SELECT u.name, COUNT(p.id)
FROM users u
LEFT JOIN posts p ON u.id = p.user_id
GROUP BY u.id, u.name;

-- Consider: Large table JOINs may need optimization
```

## Error Handling and Troubleshooting

### Common Query Issues

**Syntax Errors:**
```
"I'm getting a syntax error with this query: SELCT * FROM users"
```

**Claude identifies and fixes:**
```
I can see the issue - there's a typo in your SELECT statement. Here's the corrected query:

```sql
SELECT * FROM users;
```

The error was "SELCT" instead of "SELECT". Here are some common SQL syntax reminders:
- SQL keywords are not case-sensitive, but consistency helps readability
- Always end statements with semicolons in multi-statement contexts
- Check for matching parentheses in complex expressions
```

**Performance Issues:**
```
"My query is taking too long to run"
```

**Claude's diagnostic approach:**
1. **Analyze query structure**
2. **Check for missing indexes**
3. **Suggest query optimizations**
4. **Recommend LIMIT clauses for testing**

### Security Reminders

Claude will remind you about security best practices:

- **Read-only queries** are automatically enforced
- **Large result sets** are limited for performance
- **Sensitive data** handling recommendations
- **Query complexity** limits prevent resource abuse

## Practical Examples

### 1. Daily Reporting

**Daily Activity Report:**
```
"Create a daily activity report for yesterday"
```

**Claude generates a comprehensive report with:**
- New user registrations
- Posts published
- Comments made 
- Page views
- Most active users
- Top content

### 2. Data Quality Checks

**Find Data Issues:**
```
"Help me identify potential data quality issues in the users table"
```

**Claude checks for:**
- Duplicate emails
- Missing required fields
- Invalid data formats
- Orphaned records
- Inconsistent values

### 3. Business Metrics

**Key Performance Indicators:**
```
"Calculate our key engagement metrics for this month"
```

**Claude computes:**
- User engagement rates
- Content performance metrics
- Growth indicators
- Retention statistics

## Advanced Features

### 1. Complex Analytics

**Statistical Analysis:**
```
"Perform statistical analysis on user engagement patterns"
```

Claude can calculate:
- Standard deviations
- Percentiles and quartiles
- Correlation analysis
- Trend projections

### 2. Data Visualization Preparation

**Prepare Data for Charts:**
```
"Format user growth data for a time series chart"
```

Claude structures data optimally for:
- Line charts (time series)
- Bar charts (categorical data)
- Pie charts (proportional data)
- Scatter plots (correlations)

### 3. Export-Friendly Formats

**CSV-Ready Output:**
```
"Format the user list in CSV format"
```

Claude can structure results for easy export and further analysis.

## Best Practices for Working with Claude

### 1. Clear Communication

**Be Specific:**
```
 Good: "Show me users who registered in the last 7 days and have made at least one post"
 Vague: "Show me some recent active users"
```

### 2. Iterative Analysis

**Build on Results:**
```
"Now show me which categories those users are posting in"
"Can you break that down by user role?" 
"What's the average engagement for those posts?"
```

### 3. Context Awareness

Claude remembers the conversation context and can:
- Reference previous queries
- Build on earlier analysis
- Suggest related investigations

### 4. Ask for Explanations

```
"Can you explain what that query does step by step?"
"Why did you choose that approach?"
"What would happen if I changed this condition?"
```

## Next Steps

Now that you understand basic query operations:

1. **Explore Advanced Features** -> [Multi-Database Setup Tutorial](advanced-01-multi-database.md)
2. **Learn Security Configuration** -> [Security Configuration Tutorial](advanced-03-security.md)
3. **Optimize Performance** -> [Performance Optimization Guide](../operations/performance-tuning.md)
4. **Set Up Monitoring** -> [Monitoring Guide](../operations/monitoring.md)

## Query Reference

### Essential SQL Patterns

**Basic Selection:**
```sql
SELECT columns FROM table WHERE conditions ORDER BY column;
```

**Aggregation:**
```sql
SELECT column, COUNT(*), AVG(value) FROM table GROUP BY column;
```

**Joins:**
```sql
SELECT t1.col, t2.col FROM table1 t1 JOIN table2 t2 ON t1.id = t2.foreign_id;
```

**Subqueries:**
```sql
SELECT * FROM table WHERE column IN (SELECT column FROM other_table);
```

**Window Functions:**
```sql
SELECT column, ROW_NUMBER() OVER (ORDER BY column) FROM table;
```

### Common Analysis Patterns

- **Time-based analysis**: `DATE_TRUNC`, `EXTRACT`
- **Statistical functions**: `AVG`, `STDDEV`, `PERCENTILE_CONT`
- **String operations**: `ILIKE`, `CONCAT`, `LENGTH`
- **Conditional logic**: `CASE WHEN`, `COALESCE`, `NULLIF`

---

** Congratulations!** You now know how to effectively use Claude for database queries and analysis. The combination of Claude's AI capabilities with the Argos's security features provides a powerful platform for data exploration and business intelligence.
