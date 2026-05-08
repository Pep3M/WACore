import type { Logger } from '../utils/logger';
import type { ConnectionStatus, HealthStatus } from '../types';

export interface HealthMonitor {
  start(): void;
  stop(): void;
  updateConnection(status: ConnectionStatus, phoneNumber?: string): void;
  incrementReconnections(): void;
  getStatus(): HealthStatus;
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
  let server: ReturnType<typeof Bun.serve> | null = null;

  return {
    start() {
      const getSt = () => ({
        status: connection === 'connected' ? 'healthy' as const
              : connection === 'connecting' || connection === 'awaiting-qr' ? 'degraded' as const
              : 'unhealthy' as const,
        connection,
        phoneNumber,
        uptimeSeconds: Math.floor((Date.now() - startTime) / 1000),
        reconnections,
      });

      server = Bun.serve({
        port,
        fetch(req) {
          if (req.method === 'GET' && new URL(req.url).pathname === '/health') {
            return new Response(JSON.stringify(getSt()), {
              headers: { 'Content-Type': 'application/json' },
            });
          }
          return new Response('Not Found', { status: 404 });
        },
      });
      logger.info('Health monitor started', { port });
    },

    stop() {
      server?.stop();
      server = null;
    },

    updateConnection(status, phone) {
      connection = status;
      if (phone) phoneNumber = phone;
    },

    incrementReconnections() {
      reconnections++;
    },

    getStatus(): HealthStatus {
      const isHealthy = connection === 'connected';
      const isDegraded = connection === 'connecting' || connection === 'awaiting-qr';

      return {
        status: isHealthy ? 'healthy' : isDegraded ? 'degraded' : 'unhealthy',
        connection,
        phoneNumber,
        uptimeSeconds: Math.floor((Date.now() - startTime) / 1000),
        reconnections,
      };
    },
  };
}
