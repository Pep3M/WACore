// Los handlers de eventos de Baileys se configuran directamente
// en cliente.ts dentro de makeWASocket() via sock.ev.on().
//
// Este archivo se mantiene como punto de extensión para lógica
// de eventos más compleja que requiera su propio módulo.
//
// Actualmente los eventos se manejan en:
// - src/baileys/client.ts → sock.ev.on('connection.update', ...)
// - src/baileys/client.ts → sock.ev.on('creds.update', ...)
// - src/baileys/client.ts → sock.ev.on('messages.upsert', ...)

export {};
