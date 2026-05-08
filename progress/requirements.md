# WACore — Documento de Requisitos

> **Versión:** 1.0
> **Fecha:** {DATE}
> **Estado:** Borrador
> **Proyecto:** Backend WhatsApp sobre baileys + Bun
> **Stack:** Bun + TypeScript + baileys

---

## 1. Introducción

### 1.1 Propósito del Sistema

WACore es un backend modular para automatización de WhatsApp usando la librería baileys. Proporciona una base escalable para manejar conexiones, eventos, comandos, e integración con agentes LLM.

### 1.2 Alcance del Documento

Este documento cubre los requisitos iniciales del núcleo del sistema: conexión con WhatsApp, manejo de eventos, sistema de comandos, y capa de agente LLM.

---

## 2. Requisitos Funcionales

---

### RF-01: Conexión y autenticación con WhatsApp

> **Prioridad:** CRÍTICO
> **Descripción general:** Inicializar y mantener conexión con WhatsApp Web via baileys

#### RF-01.1 — Inicialización del socket

| Campo | Descripción |
|---|---|
| **ID** | RF-01.1 |
| **Título** | Inicializar socket Baileys |
| **Descripción** | Crear y configurar makeWASocket con auth state persistente |
| **Criterios de aceptación** | • Conexión exitosa • QR visible en terminal • Reconexión automática |

---

### RF-02: Sistema de comandos

> **Prioridad:** ALTO
> **Descripción general:** Sistema extensible de comandos del bot

---

## 3. Requisitos No Funcionales

### RNF-01: Resiliencia

| Campo | Descripción |
|---|---|
| **Descripción** | El sistema debe reconectarse automáticamente ante caídas de conexión |
| **Validación** | Simular desconexión y verificar reconexión en < 30s |

---

## 4. Próximos pasos

> Definir features con más detalle a medida que avanza el proyecto.
