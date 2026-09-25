import type { SendButtonsRequest, SendListRequest } from '../types';

/**
 * Los mismos botones y listas, escritos como texto.
 *
 * Sirve de red cuando WhatsApp rechaza el formato interactivo: mejor que el cliente reciba las
 * opciones numeradas y conteste «2» a que no reciba nada.
 *
 * **Lo que esta red no cubre:** que el envío tenga éxito y aun así el móvil del cliente pinte
 * el mensaje como texto plano por su cuenta. Eso pasa a menudo con estos formatos —son los
 * interactivos antiguos— y desde aquí no hay forma de saberlo: la red solo salta con un error.
 */

function limpiar(v: string | undefined): string {
  return (v ?? '').trim();
}

export function buttonsAsText(req: SendButtonsRequest): string {
  const partes = [limpiar(req.body)];

  const opciones = req.buttons
    .map((b, i) => `${i + 1}. ${limpiar(b.title)}`)
    .filter((linea) => linea.length > 3);

  if (opciones.length > 0) partes.push(opciones.join('\n'));

  const footer = limpiar(req.footer);
  if (footer) partes.push(footer);

  return partes.filter(Boolean).join('\n\n');
}

export function listAsText(req: SendListRequest): string {
  const partes: string[] = [];

  const header = limpiar(req.header);
  if (header) partes.push(header);

  const body = limpiar(req.body);
  if (body) partes.push(body);

  // La numeración es continua entre secciones: al cliente le pedimos que conteste un número,
  // y reiniciarla en cada sección haría que hubiera dos «1».
  let n = 0;
  for (const seccion of req.sections ?? []) {
    const lineas: string[] = [];
    const titulo = limpiar(seccion.title);
    if (titulo) lineas.push(`— ${titulo} —`);

    for (const fila of seccion.rows ?? []) {
      n++;
      const descripcion = limpiar(fila.description);
      lineas.push(`${n}. ${limpiar(fila.title)}${descripcion ? ` (${descripcion})` : ''}`);
    }

    if (lineas.length > 0) partes.push(lineas.join('\n'));
  }

  const footer = limpiar(req.footer);
  if (footer) partes.push(footer);

  return partes.filter(Boolean).join('\n\n');
}
