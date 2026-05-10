import type { Application, Request, Response } from 'express';
import express from 'express';
import type { Logger } from '../utils/logger';
import type { ConnectionStatus, HealthStatus } from '../types';

export interface HealthMonitor {
  updateConnection(status: ConnectionStatus, phoneNumber?: string): void;
  incrementReconnections(): void;
  getStatus(): HealthStatus;
  start(): void;
  stop(): void;
}

export function createHealthMonitor(
  port: number,
  logger: Logger,
  instanceName: string,
): HealthMonitor {
  let connection: ConnectionStatus = 'disconnected';
  let phoneNumber: string | null = null;
  let reconnections = 0;
  const startTime = Date.now();
  const app: Application = express();
  let server: ReturnType<typeof app.listen> | null = null;

  app.get('/health', (_req: Request, res: Response) => {
    const status: HealthStatus['status'] =
      connection === 'connected' ? 'healthy'
      : connection === 'failed' || connection === 'logged-out' ? 'unhealthy'
      : 'degraded';

    const health: HealthStatus = {
      status,
      connection,
      phoneNumber,
      uptimeSeconds: Math.floor((Date.now() - startTime) / 1000),
      reconnections,
    };

    res.json({
      status: health.status,
      connection: health.connection,
      ...(health.phoneNumber ? { phoneNumber: health.phoneNumber } : {}),
      uptimeSeconds: health.uptimeSeconds,
      reconnections: health.reconnections,
    });
  });

  return {
    updateConnection(status: ConnectionStatus, phone?: string) {
      connection = status;
      if (phone) phoneNumber = phone;
    },

    incrementReconnections() {
      reconnections++;
    },

    getStatus(): HealthStatus {
      return {
        status: connection === 'connected' ? 'healthy'
          : connection === 'failed' || connection === 'logged-out' ? 'unhealthy'
          : 'degraded',
        connection,
        phoneNumber,
        uptimeSeconds: Math.floor((Date.now() - startTime) / 1000),
        reconnections,
      };
    },

    start() {
      server = app.listen(port, () => {
        logger.info('Health monitor started', { port });
      });
    },

    stop() {
      if (server) {
        server.close();
        server = null;
      }
    },
  };
}
