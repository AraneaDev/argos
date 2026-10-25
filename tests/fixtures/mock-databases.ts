import { DatabaseAdapter } from '../../src/database/adapters/base.js';
import type {
  DatabaseConfig,
  QueryResult,
  DatabaseSchema,
  SchemaInfo,
  DatabaseConnection,
} from '../../src/types/database.js';

/**
 * Mock database adapter for testing
 */
export class MockDatabaseAdapter extends DatabaseAdapter {
  private mockConnection: any = null;
  private shouldFailConnection = false;
  private shouldTimeout = false;
  private connectionDelay = 100;
  private queryDelay = 50;
  private mockSchema: DatabaseSchema | null = null;
  private queryHistory: Array<{ query: string; params?: any[]; timestamp: Date }> = [];

  constructor(config: DatabaseConfig) {
    super(config);
  }

  /**
   * Configure mock behavior
   */
  configure(options: {
    shouldFailConnection?: boolean;
    shouldTimeout?: boolean;
    connectionDelay?: number;
    queryDelay?: number;
    mockSchema?: DatabaseSchema;
  }): void {
    this.shouldFailConnection = options.shouldFailConnection ?? false;
    this.shouldTimeout = options.shouldTimeout ?? false;
    this.connectionDelay = options.connectionDelay ?? 100;
    this.queryDelay = options.queryDelay ?? 50;
    this.mockSchema = options.mockSchema ?? null;
  }

  async connect(): Promise<DatabaseConnection> {
    await this.delay(this.connectionDelay);

    if (this.shouldTimeout) {
      throw new Error('Connection timeout');
    }

    if (this.shouldFailConnection) {
      throw new Error('Connection failed');
    }

    this.mockConnection = { id: 'mock-connection', connected: true };
    return this.mockConnection;
  }

  async disconnect(connection: DatabaseConnection): Promise<void> {
    await this.delay(50);
    if (this.mockConnection) {
      this.mockConnection.connected = false;
    }
  }

  isConnected(connection: DatabaseConnection): boolean {
    return this.mockConnection && this.mockConnection.connected === true;
  }

  async executeQuery(
    connection: DatabaseConnection,
    query: string,
    params: unknown[] = []
  ): Promise<QueryResult> {
    if (!this.isConnected(connection)) {
      throw new Error('Not connected to database');
    }

    // Record query in history
    this.queryHistory.push({
      query: query.trim(),
      params,
      timestamp: new Date(),
    });

    await this.delay(this.queryDelay);

    // Generate mock result
    return this.generateMockResult(query, params);
  }

  async beginTransaction(connection: DatabaseConnection): Promise<void> {
    if (!this.isConnected(connection)) {
      throw new Error('Not connected to database');
    }
    // Mock transaction begin
  }

  async commitTransaction(connection: DatabaseConnection): Promise<void> {
    if (!this.isConnected(connection)) {
      throw new Error('Not connected to database');
    }
    // Mock transaction commit
  }

  async rollbackTransaction(connection: DatabaseConnection): Promise<void> {
    if (!this.isConnected(connection)) {
      throw new Error('Not connected to database');
    }
    // Mock transaction rollback
  }

  buildExplainQuery(query: string): string {
    return `EXPLAIN ${query}`;
  }

  fingerprintQuery(): string {
    return 'SELECT 1 AS argos_fingerprint';
  }

  protected extractFieldNames(result: unknown): string[] {
    if (typeof result === 'object' && result !== null && 'fields' in result) {
      return (result as any).fields || [];
    }
    return [];
  }

  protected extractRawRows(result: unknown): unknown[] {
    if (typeof result === 'object' && result !== null && 'rows' in result) {
      return (result as any).rows || [];
    }
    return [];
  }

  async captureSchema(connection: DatabaseConnection): Promise<DatabaseSchema> {
    if (this.mockSchema) {
      return this.mockSchema;
    }

    // Return default mock schema
    const schema: DatabaseSchema = {
      database: 'mock_database',
      type: 'postgresql',
      captured_at: new Date().toISOString(),
      tables: {
        users: {
          name: 'users',
          type: 'table',
          comment: 'User accounts table',
          columns: [
            {
              name: 'id',
              type: 'integer',
              nullable: false,
              default: "nextval('users_id_seq'::regclass)",
              max_length: null,
              precision: null,
              scale: null,
              comment: 'Primary key',
              key: 'PRI',
              extra: 'auto_increment',
            },
            {
              name: 'name',
              type: 'varchar',
              nullable: false,
              default: null,
              max_length: 255,
              precision: null,
              scale: null,
              comment: 'User full name',
              key: '',
              extra: '',
            },
            {
              name: 'email',
              type: 'varchar',
              nullable: true,
              default: null,
              max_length: 255,
              precision: null,
              scale: null,
              comment: 'User email address',
              key: 'UNI',
              extra: '',
            },
          ],
        },
        posts: {
          name: 'posts',
          type: 'table',
          comment: 'Blog posts table',
          columns: [
            {
              name: 'id',
              type: 'integer',
              nullable: false,
              default: "nextval('posts_id_seq'::regclass)",
              max_length: null,
              precision: null,
              scale: null,
              comment: 'Primary key',
              key: 'PRI',
              extra: 'auto_increment',
            },
            {
              name: 'user_id',
              type: 'integer',
              nullable: false,
              default: null,
              max_length: null,
              precision: null,
              scale: null,
              comment: 'Foreign key to users table',
              key: 'MUL',
              extra: '',
            },
            {
              name: 'title',
              type: 'varchar',
              nullable: false,
              default: null,
              max_length: 255,
              precision: null,
              scale: null,
              comment: 'Post title',
              key: '',
              extra: '',
            },
            {
              name: 'content',
              type: 'text',
              nullable: true,
              default: null,
              max_length: null,
              precision: null,
              scale: null,
              comment: 'Post content',
              key: '',
              extra: '',
            },
          ],
        },
      },
      views: {
        user_post_count: {
          name: 'user_post_count',
          type: 'view',
          comment: 'View showing user post counts',
          columns: [
            { name: 'id', type: 'integer', nullable: false, default: null, comment: 'User ID' },
            {
              name: 'name',
              type: 'varchar',
              nullable: false,
              default: null,
              max_length: 255,
              comment: 'User name',
            },
            {
              name: 'post_count',
              type: 'bigint',
              nullable: false,
              default: null,
              comment: 'Number of posts',
            },
          ],
        },
      },
      summary: {
        table_count: 2,
        view_count: 1,
        total_columns: 8,
      },
    };

    return schema;
  }

  async getSchemaInfo(schema: DatabaseSchema): Promise<SchemaInfo> {
    const tables = Object.values(schema.tables);
    const views = Object.values(schema.views);

    return {
      table_count: schema.summary.table_count,
      view_count: schema.summary.view_count,
      function_count: 0, // Mock has no functions
      sequence_count: 0, // Mock has no sequences
      total_columns: schema.summary.total_columns,
      total_indexes: tables.length * 2, // Mock: assume 2 indexes per table
      foreign_key_count: 1, // Mock: one FK from posts to users
    };
  }

  private generateMockResult(query: string, params: unknown[] = []): QueryResult {
    const normalizedQuery = query.trim().toLowerCase();
    const startTime = Date.now();

    // SELECT queries
    if (normalizedQuery.startsWith('select')) {
      if (normalizedQuery.includes('from users')) {
        return {
          rows: [
            { id: 1, name: 'John Doe', email: 'john@example.com' },
            { id: 2, name: 'Jane Smith', email: 'jane@example.com' },
          ],
          rowCount: 2,
          fields: ['id', 'name', 'email'],
          truncated: false,
          execution_time_ms: Date.now() - startTime,
        };
      }

      if (normalizedQuery.includes('from posts')) {
        return {
          rows: [
            { id: 1, user_id: 1, title: 'First Post', content: 'This is the first post' },
            { id: 2, user_id: 1, title: 'Second Post', content: 'This is the second post' },
            { id: 3, user_id: 2, title: "Jane's Post", content: 'Post by Jane' },
          ],
          rowCount: 3,
          fields: ['id', 'user_id', 'title', 'content'],
          truncated: false,
          execution_time_ms: Date.now() - startTime,
        };
      }

      // Generic SELECT result
      return {
        rows: [{ result: 'mock data' }],
        rowCount: 1,
        fields: ['result'],
        truncated: false,
        execution_time_ms: Date.now() - startTime,
      };
    }

    // INSERT queries
    if (normalizedQuery.startsWith('insert')) {
      return {
        rows: [],
        rowCount: 1,
        fields: [],
        truncated: false,
        execution_time_ms: Date.now() - startTime,
      };
    }

    // UPDATE queries
    if (normalizedQuery.startsWith('update')) {
      return {
        rows: [],
        rowCount: 1,
        fields: [],
        truncated: false,
        execution_time_ms: Date.now() - startTime,
      };
    }

    // DELETE queries
    if (normalizedQuery.startsWith('delete')) {
      return {
        rows: [],
        rowCount: 1,
        fields: [],
        truncated: false,
        execution_time_ms: Date.now() - startTime,
      };
    }

    // Default result
    return {
      rows: [],
      rowCount: 0,
      fields: [],
      truncated: false,
      execution_time_ms: Date.now() - startTime,
    };
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Test utilities
   */
  getQueryHistory(): Array<{ query: string; params?: any[]; timestamp: Date }> {
    return [...this.queryHistory];
  }

  clearQueryHistory(): void {
    this.queryHistory = [];
  }

  setMockResult(query: string, result: QueryResult): void {
    // Mock can store specific results if needed
  }

  clearMockResults(): void {
    // Mock can clear results if needed
  }

  isCurrentlyConnected(): boolean {
    return this.mockConnection ? this.mockConnection.connected === true : false;
  }
}

/**
 * Mock database factory for creating different types of mock adapters
 */
export class MockDatabaseFactory {
  static createPostgresAdapter(config: DatabaseConfig, options?: any): MockDatabaseAdapter {
    const adapter = new MockDatabaseAdapter(config);
    if (options) {
      adapter.configure(options);
    }
    return adapter;
  }

  static createMysqlAdapter(config: DatabaseConfig, options?: any): MockDatabaseAdapter {
    const adapter = new MockDatabaseAdapter(config);
    if (options) {
      adapter.configure(options);
    }
    return adapter;
  }

  static createSqliteAdapter(config: DatabaseConfig, options?: any): MockDatabaseAdapter {
    const adapter = new MockDatabaseAdapter(config);
    if (options) {
      adapter.configure(options);
    }
    return adapter;
  }

  static createFailingAdapter(config: DatabaseConfig): MockDatabaseAdapter {
    const adapter = new MockDatabaseAdapter(config);
    adapter.configure({ shouldFailConnection: true });
    return adapter;
  }

  static createTimeoutAdapter(config: DatabaseConfig): MockDatabaseAdapter {
    const adapter = new MockDatabaseAdapter(config);
    adapter.configure({ shouldTimeout: true, connectionDelay: 5000 });
    return adapter;
  }

  static createSlowAdapter(config: DatabaseConfig): MockDatabaseAdapter {
    const adapter = new MockDatabaseAdapter(config);
    adapter.configure({ connectionDelay: 1000, queryDelay: 500 });
    return adapter;
  }
}

/**
 * Sample test data for different scenarios
 */
export class MockDataGenerator {
  static generateUsers(count: number): any[] {
    const users = [];
    for (let i = 1; i <= count; i++) {
      users.push({
        id: i,
        name: `User ${i}`,
        email: `user${i}@example.com`,
        created_at: new Date(2023, 0, i).toISOString(),
      });
    }
    return users;
  }

  static generatePosts(userCount: number, postsPerUser: number): any[] {
    const posts = [];
    let postId = 1;

    for (let userId = 1; userId <= userCount; userId++) {
      for (let i = 1; i <= postsPerUser; i++) {
        posts.push({
          id: postId++,
          user_id: userId,
          title: `Post ${i} by User ${userId}`,
          content: `This is post number ${i} created by user ${userId}`,
          score: Math.floor(Math.random() * 100),
          created_at: new Date(2023, 0, userId, i).toISOString(),
        });
      }
    }

    return posts;
  }

  static generateLargeDataset(rowCount: number): any[] {
    const data = [];
    for (let i = 0; i < rowCount; i++) {
      data.push({
        id: i + 1,
        value: `Value ${i + 1}`,
        random_number: Math.floor(Math.random() * 10000),
        timestamp: new Date().toISOString(),
      });
    }
    return data;
  }
}
