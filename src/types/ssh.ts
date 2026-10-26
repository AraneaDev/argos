/**
 * SSH tunnel-related types and interfaces
 */

import type { Client as SSHClient } from 'ssh2';
import type * as net from 'net';

// ============================================================================
// SSH Connection Types
// ============================================================================

export interface SSHConnectionConfig {
  host: string;
  port: number;
  username: string;
  password?: string;
  privateKey?: Buffer | string;
  passphrase?: string;
  /** Expected host key fingerprint (SHA256:base64, bare base64, or hex). When set, the host key is pinned. */
  hostFingerprint?: string;
  /** Reject unknown/unpinned host keys (default true = fail secure). */
  strictHostKeyChecking?: boolean;
}

export interface SSHForwardConfig {
  sourceHost: string;
  sourcePort: number;
  destinationHost: string;
  destinationPort: number;
}

export interface SSHTunnelInfo {
  server: net.Server;
  connection: SSHClient;
  localPort: number;
  localHost: string;
  remoteHost: string;
  remotePort: number;
  isActive: boolean;
}

export interface SSHTunnelCreateOptions {
  sshConfig: SSHConnectionConfig;
  forwardConfig: SSHForwardConfig;
  localPort?: number; // 0 for auto-assignment
  localHost?: string; // Bind address for the local tunnel server (default: '127.0.0.1')
}

// ============================================================================
// SSH Tunnel Manager Interface
// ============================================================================

export interface ISSHTunnelManager {
  createTunnel(_dbName: string, _options: SSHTunnelCreateOptions): Promise<SSHTunnelInfo>;
  getTunnel(_dbName: string): SSHTunnelInfo | undefined;
  closeTunnel(_dbName: string): Promise<void>;
  closeAllTunnels(): Promise<void>;
  isConnected(_dbName: string): boolean;
}

// ============================================================================
// SSH Connection Events
// ============================================================================

export type SSHConnectionEvent = 'ready' | 'error' | 'close' | 'end' | 'timeout';

export interface SSHEventPayload {
  event: SSHConnectionEvent;
  tunnel: SSHTunnelInfo;
  error?: Error;
  message?: string;
}

// ============================================================================
// SSH Authentication Types
// ============================================================================

// ============================================================================
// SSH Tunnel Status
// ============================================================================

export type SSHTunnelStatus =
  'connecting' | 'connected' | 'error' | 'disconnected' | 'reconnecting';

export interface SSHTunnelStatusInfo {
  status: SSHTunnelStatus;
  connectedAt?: Date;
  lastError?: string;
  reconnectAttempts: number;
  isHealthy: boolean;
}

// ============================================================================
// Type Guards
// ============================================================================

// ============================================================================
// Utility Functions
// ============================================================================

export interface SSHTunnelValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 *
 */
export function validateSSHConfig(config: SSHConnectionConfig): SSHTunnelValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!config.host || config.host.trim() === '') {
    errors.push('SSH host is required');
  }

  if (!config.port || config.port < 1 || config.port > 65535) {
    errors.push('SSH port must be between 1 and 65535');
  }

  if (!config.username || config.username.trim() === '') {
    errors.push('SSH username is required');
  }

  if (!config.password && !config.privateKey) {
    errors.push('Either password or private key must be provided');
  }

  if (config.password && config.privateKey) {
    warnings.push('Both password and private key provided, private key will take precedence');
  }

  if (config.privateKey && !config.passphrase) {
    warnings.push('Private key provided without passphrase, ensure key is not encrypted');
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
  };
}
