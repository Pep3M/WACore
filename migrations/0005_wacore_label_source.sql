-- De dónde salió cada etiqueta y cada asociación.
--
-- `wa`    lo contó WhatsApp por `labels.edit` / `labels.association`.
-- `local` lo escribimos nosotros y WhatsApp todavía no lo ha confirmado.
--
-- Hace falta porque las cuentas Business modernas (las de la interfaz «Listas» en vez de
-- «Etiquetas») **no disparan esos eventos**: si sólo guardáramos lo que llega por el eco, un
-- POST que devuelve 200 dejaría `GET /api/labels` vacío y parecería que no se guardó nada.
--
-- El valor por omisión es `wa` a propósito: lo que ya está en la tabla llegó por el eco.
--
-- Solo en `wacore_labels`. En las asociaciones no se guarda: `getAssociations` devuelve
-- listas planas de jids y no hay por dónde leerlo, así que sería una columna que nadie
-- puede consultar. La escritura local de una asociación se comprueba porque **aparece en
-- el listado**, que es lo que hacía falta.
ALTER TABLE "wacore_labels"
  ADD COLUMN IF NOT EXISTS "source" text NOT NULL DEFAULT 'wa';
