import type { Application, Request, Response } from 'express';
import express from 'express';
import type { Logger } from '../utils/logger';
import type { ConnectionStatus, HealthStatus } from '../types';

export interface HealthMonitor {
  updateConnection(status: ConnectionStatus, phoneNumber?: string): void;
  incrementReconnections(): void;
  getStatus(): HealthStatus;
  /**
   * Contadores adicionales que se publican en `/health` bajo `transport` (hoy, los del pool de
   * Postgres). Se inyecta porque los servicios que los llevan se construyen después.
   */
  setTransportStats(provider: () => Record<string, unknown>): void;
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
  let transportStats: (() => Record<string, unknown>) | null = null;
  const startTime = Date.now();
  const app: Application = express();
  let server: ReturnType<typeof app.listen> | null = null;

  app.get('/health', (_req: Request, res: Response) => {
    const status: HealthStatus['status'] =
      connection === 'connected' ? 'healthy'
      : connection === 'connecting' || connection === 'awaiting-qr' ? 'degraded'
      : 'unhealthy';

    const health: HealthStatus = {
      status,
      connection,
      phoneNumber,
      uptimeSeconds: Math.floor((Date.now() - startTime) / 1000),
      reconnections,
    };

    let transport: Record<string, unknown> | undefined;
    try {
      transport = transportStats?.();
    } catch {
      // Una sonda de salud nunca puede devolver un 500 por un contador: eso convertiría un
      // detalle informativo en un contenedor marcado como muerto.
      transport = { error: 'unavailable' };
    }

    res.json({
      status: health.status,
      connection: health.connection,
      phoneNumber: health.phoneNumber,
      uptimeSeconds: health.uptimeSeconds,
      reconnections: health.reconnections,
      ...(transport ? { transport } : {}),
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

    setTransportStats(provider: () => Record<string, unknown>) {
      transportStats = provider;
    },

    getStatus(): HealthStatus {
      return {
        status: connection === 'connected' ? 'healthy'
          : connection === 'connecting' || connection === 'awaiting-qr' ? 'degraded'
          : 'unhealthy',
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
