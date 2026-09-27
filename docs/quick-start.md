# Quick start

```bash
# 1. Clonar e instalar dependencias
git clone https://github.com/Pep3M/WACore.git && cd WACore
bun install

# 2. Configurar (mínimo: API_KEY)
cp .env.example .env
# Editar .env y poner API_KEY=mi-clave-segura

# 3. Iniciar
bun start
```

En la terminal verás un código QR. Escanéalo con WhatsApp → **Ajustes > Dispositivos vinculados > Vincular un dispositivo**.

Una vez conectado, la API REST está disponible en `http://localhost:9878`.
