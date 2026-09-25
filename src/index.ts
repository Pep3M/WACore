import { loadConfig } from './config';
import { createLogger } from './utils/logger';
import { createEventBus } from './core/event-bus';
import { createMessageRouter } from './core/message-router';
import { createHealthMonitor } from './core/health';
import { createWebhookDispatcher } from './transport/webhook-dispatcher';
import { createRestApi } from './transport/rest-api';
import { createSSETransport } from './transport/sse-transport';
import { createIncomingMessageHub } from './core/incoming-message-hub';
import { createContactStore } from './storage/contact-store';
import { createLabelStore } from './storage/label-store';
import { createTemplateStore } from './storage/template-store';
import { createCommandRegistry } from './commands/registry';
import { DiskMediaStore } from './storage/media-store';
import { createMediaDownloader } from './services/media-downloader';
import { createSessionManager } from './sessions/session-manager';

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config);

  // Los plazos del pool se fijan **antes** de que nadie abra uno: la primera conexión se crea unas
  // líneas más abajo, con los almacenes de contactos y etiquetas.
  const { configurarPoolPorDefecto } = await import('./storage/postgres-db');
  configurarPoolPorDefecto({
    max: config.dbPoolMax,
    statementTimeoutMs: config.dbStatementTimeoutMs,
    idleTxTimeoutMs: config.dbIdleTxTimeoutMs,
  });

  // ─── PostgreSQL startup gate ──────────────────────────────
  if (config.sessionStore === 'postgres') {
    if (!config.databaseUrl) {
      logger.error('SESSION_STORE=postgres requires DATABASE_URL');
      process.exit(1);
    }
    const { waitForPostgres, runMigrations } = await import('./storage/postgres-db');
    try {
      await waitForPostgres(config.databaseUrl!, logger, 30_000);
      await runMigrations(config.databaseUrl!, logger);
      logger.info('PostgreSQL ready, migrations applied');
    } catch (err) {
      logger.error('PostgreSQL startup failed', { error: String(err) });
      process.exit(1);
    }
  }

  const globalEventBus = createEventBus();
  const contactStore = await createContactStore(config.sessionStore, config.databaseUrl);
  const labelStore = await createLabelStore(config.sessionStore, config.databaseUrl);
  const templateStore = await createTemplateStore(config.sessionStore, config.databaseUrl);
  const mediaStore = new DiskMediaStore(config.mediaDir, logger);

  // ─── Session manager (multi-session pool) ─────────────────
  const sessionManager = createSessionManager({ config, globalEventBus, contactStore, labelStore, logger });
  await sessionManager.bootstrap();

  // ─── Shared services (listen to global bus) ──────────────
  const mediaDownloader = createMediaDownloader(mediaStore, globalEventBus, logger, config.mediaAutoDownload, config.mediaBaseUrl);
  const healthMonitor = createHealthMonitor(config.healthPort, logger, config.instanceName);
  const messageRouter = createMessageRouter(globalEventBus, logger, { publishFromMe: config.publishFromMe });
  const webhookDispatcher = createWebhookDispatcher(globalEventBus, config, logger);

  // Vigilante del pool de Postgres. Termina desde fuera las conexiones que se quedan atascadas a
  // media conversación del protocolo, que es el atasco que ningún plazo del servidor deshace y el
  // que dejó a todas las líneas sin poder generar códigos QR.
  let poolWatchdog: import('./storage/postgres-watchdog').PoolWatchdog | undefined;
  if (config.sessionStore === 'postgres' && config.databaseUrl) {
    const { createPoolWatchdog } = await import('./storage/postgres-watchdog');
    poolWatchdog = createPoolWatchdog({
      databaseUrl: config.databaseUrl,
      logger,
      intervalMs: config.dbWatchdogIntervalMs ?? 30_000,
      maxAgeMs: config.dbWatchdogMaxAgeMs ?? 60_000,
    });
    poolWatchdog.start();
  }

  const { contadorConexionesCorrompidas } = await import('./storage/postgres-store');

  healthMonitor.setTransportStats(() => ({
    // Los dos contadores de la base de datos. Sin ellos esta avería vuelve a ser invisible hasta
    // que alguien se ponga a leer registros: lo que se ve desde fuera es «no salen los QR».
    postgres: {
      conexionesCorrompidas: contadorConexionesCorrompidas(),
      ...(poolWatchdog ? { vigilante: poolWatchdog.stats() } : {}),
    },
  }));
  const incomingHub = createIncomingMessageHub(globalEventBus, logger, {
    maxSize: config.messageBufferSize,
    ttlMs: config.messageBufferTtlMs,
  });
  let sseTransport: ReturnType<typeof createSSETransport> | undefined;
  if (config.sseEnabled) {
    sseTransport = createSSETransport(incomingHub, globalEventBus, logger, config.sseHeartbeatMs);
  }

  const restApi = createRestApi(
    config.apiPort,
    config,
    logger,
    sessionManager,
    incomingHub,
    sseTransport,
    mediaStore,
    contactStore,
    labelStore,
    templateStore,
  );

  // ─── Bridge: connection updates → health monitor ─────────────
  let wasConnected = false;
  globalEventBus.on('connection.update', (update) => {
    healthMonitor.updateConnection(update.status as any, update.phoneNumber);
    if (update.status === 'connected') {
      if (wasConnected) healthMonitor.incrementReconnections();
      wasConnected = true;
    }
  });

  // ─── Command system ───────────────────────────────────────────
  // Reply is routed through the session that received the command, not a hardcoded legacy session.
  const commandRegistry = createCommandRegistry(
    globalEventBus,
    (to, text, sessionId) => {
      const session = sessionManager.getOrLegacy(sessionId);
      return session.presenceManager.sendWithTyping(to, () => session.messageSender.sendText(to, text));
    },
    logger,
  );

  commandRegistry.register({
    name: 'ping',
    description: 'Responde con pong y el tiempo de respuesta',
    handler: async (_msg, _args, reply) => {
      const start = Date.now();
      await reply('🏓 Pong!');
      const elapsed = Date.now() - start;
      await reply(`⏱️ ${elapsed}ms`);
    },
  });

  commandRegistry.register({
    name: 'help',
    aliases: ['h', 'comandos'],
    description: 'Muestra la lista de comandos disponibles',
    handler: async (_msg, _args, reply) => {
      const list = commandRegistry.getAll()
        .map(cmd => `• *!${cmd.name}* ${cmd.usage ? `\`${cmd.usage}\` ` : ''}— ${cmd.description}`)
        .join('\n');
      await reply(`📋 *Comandos disponibles:*\n\n${list}`);
    },
  });

  commandRegistry.start();

  // ─── Start media downloader ──────────────────────────────────
  mediaDownloader.start();

  // ─── Start subsystems ───────────────────────────────────────
  healthMonitor.start();
  messageRouter.start();
  incomingHub.start();
  webhookDispatcher.start();
  restApi.start();

  // ─── Handle shutdown ────────────────────────────────────────
  const shutdown = async (signal: string) => {
    logger.info('Shutdown signal received', { signal });
    commandRegistry.stop();
    mediaDownloader.stop();
    await poolWatchdog?.stop();
    await sessionManager.stopAll();
    webhookDispatcher.stop();
    messageRouter.stop();
    incomingHub.stop();
    sseTransport?.stop();
    restApi.stop();
    healthMonitor.stop();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  logger.info('WACore started', {
    instance: config.instanceName,
    sessionStore: config.sessionStore,
    sessions: sessionManager.list().length,
  });
}

main().catch((err) => {
  console.error('Fatal error during startup:', err);
  process.exit(1);
});
