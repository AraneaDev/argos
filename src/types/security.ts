/**
 * Security-related types and interfaces
 */

// ============================================================================
// Security Validation Types
// ============================================================================

export interface SecurityValidation {
  allowed: boolean;
  reason?: string;
  confidence: number;
  blockedCommand?: string;
}

// ============================================================================
// Query Complexity Analysis Types
// ============================================================================

export type ComplexityRiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface QueryComplexityAnalysis {
  score: number;
  factors: string[];
  joinCount: number;
  subqueryCount: number;
  unionCount: number;
  groupByCount: number;
  windowFuncCount: number;
  risk_level: ComplexityRiskLevel;
}

export interface ComplexityLimits {
  maxJoins: number;
  maxSubqueries: number;
  maxUnions: number;
  maxGroupBys: number;
  maxComplexityScore: number;
  maxQueryLength: number;
}

// ============================================================================
// SQL Token Types
// ============================================================================

export type TokenType = 'KEYWORD' | 'IDENTIFIER' | 'STRING' | 'OPERATOR' | 'UNKNOWN';

export interface SQLToken {
  value: string;
  type: TokenType;
  position: number;
  normalized: string;
}

// ============================================================================
// Audit Log Types
// ============================================================================

export type LogSeverity = 'INFO' | 'WARNING' | 'ERROR' | 'CRITICAL';

// ============================================================================
// Security Configuration Types
// ============================================================================

export interface SecurityConfig {
  max_joins?: number | string;
  max_subqueries?: number | string;
  max_unions?: number | string;
  max_group_bys?: number | string;
  max_complexity_score?: number | string;
  max_query_length?: number | string;
}

export interface SecurityManagerConfig {
  security?: SecurityConfig;
}

// ============================================================================
// Dangerous Pattern Detection Types
// ============================================================================

// ============================================================================
// Security Manager Interface
// ============================================================================

export interface ISecurityManager {
  validateSelectOnlyQuery(_query: string, _dbType?: string): SecurityValidation;
  analyzeQueryComplexity(_query: string): QueryComplexityAnalysis;
}

// ============================================================================
// Type Guards
// ============================================================================
