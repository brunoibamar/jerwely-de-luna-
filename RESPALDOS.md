# Respaldos de Joyería de Luna

## Consulta detallada `20261104-history1`

“Consultar historial por meses” abre una ventana amplia, con selectores de año
y mes. Presenta ventas vigentes/canceladas, importes antes de devoluciones,
devoluciones, ventas netas, piezas netas y promedio neto por venta.
Incluye agrupación por forma de pago y un historial completo con búsqueda por
folio/producto/cajero y páginas de 25 registros. “Ver productos y pago” muestra
partidas, cantidades, precio unitario cuando está registrado, importes, detalles
de cobro y devoluciones asociadas. Los desgloses por día y producto son desplegables.
Las ventas mixtas constituyen un grupo propio; el detalle conserva su reparto.
Las devoluciones se descuentan del mes de la venta original. Las cancelaciones
se muestran sin sumarlas. La consulta usa la fecha del respaldo verificado;
no importa ni modifica registros. Los meses sin ventas se señalan explícitamente.
Después de un nuevo respaldo externo exitoso se reemplaza cualquier aviso viejo
de selección rechazada por la confirmación actual.

`tests/monthly-archive-view.cjs` verifica selección, búsqueda, paginación,
detalle, cancelaciones, devoluciones posteriores, contenido tratado como texto,
ausencia de cambios operativos y, opcionalmente, vista móvil con el JSON real.

## Versión de pruebas `20261103-monthly-sale1`

Corrección `20261104-folder1`: el selector puede devolver `AbortError` tanto al
cancelarse como al rechazar una carpeta protegida. El aviso distingue esa
posibilidad y pide elegir una subcarpeta, no todo Escritorio/Documentos/Descargas.
Guardar respaldo ahora abre el selector directamente desde el clic cuando no
hay carpeta configurada; un rechazo no se presenta como respaldo externo exitoso.
`tests/folder-activation.cjs` comprueba este flujo y prueba escritura, verificación
y persistencia con manejadores nativos en un perfil aislado. El permiso y el
selector de la carpeta real del cliente deben comprobarse en su navegador.

Esta sección sustituye las limitaciones de consulta mensual descritas más abajo
para las versiones anteriores. Se prueba en `punto-de-venta-refactor`; no cambia `main`.

- Cada venta confirmada espera el intento de respaldo externo. Una falla no
  deshace la venta: se informa que quedó pendiente y se puede reintentar.
- Los respaldos automáticos en carpeta crean una generación mensual verificada,
  además del JSON completo. Las generaciones anteriores se conservan. Esto
  consume espacio en disco: no es almacenamiento ilimitado ni sincronización en nube.
- Reportes → Mes permite elegir mes y año, consultar totales, gráficas por día
  y productos más vendidos. Reportes → Año reúne los meses del año seleccionado.
  La lectura del reporte consulta sólo los archivos mensuales necesarios,
  verifica sus huellas y combina registros locales sin duplicar ventas.
- `Ultima_copia.json` permite localizar la generación vigente desde la carpeta.
  Conserva toda la carpeta y sus subcarpetas; no muevas archivos individuales.
- Configuración → **Verificar y archivar meses terminados** requiere administrador,
  caja cerrada y confirmación. Es una acción manual: verifica una copia completa,
  compara nuevamente los registros dentro de una transacción y retira sólo ventas
  e historial anteriores al mes actual. Fechas inválidas, mes activo, inventario,
  clientes, devoluciones, cortes y originales de migración se conservan.
- Los originales y las copias de recuperación siguen ocupando espacio; este paso
  reduce el historial operativo y no promete vaciar todo el almacenamiento.
  Las vistas diarias, semanales y las operaciones sobre ventas consultan los
  registros locales; para meses archivados usa las consultas mensuales y anuales.
- El JSON completo descargado reúne también los meses archivados. Si falta la
  carpeta, no se anuncia un respaldo completo. La descarga de seguridad del corte
  puede conservar los datos locales y advierte si faltan meses archivados.
- Después de archivar, mantén disponible la carpeta original. Para cambiarla,
  conserva también su contenido. Una carpeta vacía no reemplaza el historial.
- `node scripts/preview.cjs` sirve una vista en `http://127.0.0.1:48731/`, con
  almacenamiento separado del sitio público y conexiones externas bloqueadas.
  No sirve respaldos ni pruebas. El JSON se importa desde la interfaz local.

Prueba adicional: `tests/monthly-operation.cjs`. La variable opcional
`POS_REVIEW_JSON` permite comprobar un respaldo real en un perfil aislado;
el archivo del cliente no se incorpora al repositorio.

La versión `20261102-compact2` agrupa “Crear sólo copia por meses”, “Pausar
respaldo automático” y “Recuperar copia de este navegador” en “Opciones
avanzadas”. Todas las acciones siguen disponibles. “Guardar respaldo ahora”
ejecuta el respaldo habitual y además intenta crear una copia mensual
verificada. “Reactivar permiso” permanece visible fuera del grupo cuando hace
falta. Ninguno de estos cambios retira registros del navegador.

## Traslado automático del almacenamiento

Al cargar esta versión en la misma computadora y perfil del navegador, el sistema copia los registros
operativos de LocalStorage a IndexedDB. No requiere acceso de administrador ni elegir una carpeta.
Durante la preparación se muestra un aviso: esperar a que termine y evitar abrir otra pestaña del sistema.

La copia se compara literalmente con la información anterior, sin cambiar folios, fechas, montos ni puntos.
Los valores originales se conservan en un apartado separado de la base local. Sólo después de verificar
se retira el duplicado del espacio pequeño del navegador. Una interrupción puede reanudarse al abrir de nuevo.
Si no se puede verificar o hay cambios de una pestaña con una versión anterior, se detiene el arranque y
se ofrece un respaldo de emergencia; no se inicia un negocio vacío encima de los registros existentes.

Las nuevas ventas confirman juntas venta, historial, inventario y puntos VIP. Un error de escritura conserva
el carrito. El corte confirma su historial y el cierre de turno en una transacción; un error mantiene la caja abierta.
Los registros se verifican al abrir y antes de preparar nuevas operaciones. Sigue siendo almacenamiento de
ese navegador y computadora: no sustituye un respaldo en archivo ante pérdida del equipo o borrado del navegador.

## Activar una carpeta en la computadora del negocio

1. En Chrome o Edge, iniciar sesión como administrador y abrir Configuración → Respaldos del negocio.
2. Elegir **Elegir carpeta de respaldos**, seleccionar una carpeta y permitir el acceso.
3. Confirmar que el estado indique ACTIVO y muestre la fecha del último guardado verificado.
4. Si aparece EN PAUSA, presionar **Reactivar permiso**. El navegador puede pedir el permiso otra vez al reiniciar.

Si **Elegir carpeta de respaldos** explica que la función no está habilitada (puede ocurrir en Brave),
usar **Descargar respaldo completo (JSON)**. La descarga manual y la importación de JSON siguen disponibles.
El sitio no puede habilitar por su cuenta una función que el navegador bloquea. No cambiar de navegador
esperando que aparezcan los mismos registros: los datos locales no se transfieren automáticamente.

Se crean archivos JSON completos y distintos, en subcarpetas por día. No se eliminan las copias anteriores.
Al cerrar caja, el sistema espera el guardado de un archivo `JDL_Corte_...json` que contiene todo el negocio
y el reporte del turno recién cerrado. El resumen confirma la carpeta sólo después de leer y comparar
el archivo. Funciona también al cerrar como empleada, sin permitirle cambiar la carpeta configurada.
Si falta carpeta, permiso o espacio, el corte queda guardado internamente y se intenta descargar un JSON
de seguridad. Comprobar que la descarga terminó; el resumen explica el resultado y permite reintentar
con **Descargar JSON del corte**. No repetir el corte para reintentar el respaldo.
El programa intenta respaldar después de ventas, devoluciones, garantías, movimientos VIP y cortes, y cada hora
mientras esté abierto. Los cambios de inventario o configuración también se incluyen en la siguiente copia
completa; para guardarlos inmediatamente, pulsar **Respaldar ahora**.

La copia del navegador y la carpeta dependen de esa computadora. Conservar también un archivo en una unidad
externa u otro equipo, especialmente al terminar el mes. Si se llena el disco o se pierde el permiso, revisar
el aviso: una copia fallida no se marca como verificada.

## Archivo mensual

Pulsar **Descargar respaldo completo (JSON)**. Incluye todo el historial acumulado, no únicamente las ventas
mensuales. Confirmar el recordatorio sólo después de comprobar que el archivo terminó de descargarse y
se guardó correctamente. El aviso vuelve a quedar pendiente al comenzar otro mes. Conservar archivos anteriores.

Los archivos incluyen información privada del negocio y datos originales de recuperación. Guardarlos en
una carpeta controlada por el administrador.

## Recuperar un archivo

1. Conservar el JSON original; no editarlo ni cargarlo con opciones de borrado del navegador.
2. Terminar cualquier cobro pendiente y cerrar las otras pestañas del punto de venta.
3. Abrir **Importar archivo JSON** y seleccionar el JSON deseado.
4. Revisar el resultado antes de recargar: se agregan registros faltantes. Si hay diferencias para un mismo
   registro, se conserva el actual y el mensaje informa cuántas diferencias hubo. No se renumeran folios.

Antes de escribir se valida la entrada y se conserva el archivo completo y el estado previo en IndexedDB.
Los cambios operativos de la importación se confirman juntos en una transacción de IndexedDB.
Si falla una escritura, no se aplican parcialmente esos cambios.
Un mensaje de error no debe interpretarse como una recuperación terminada. Conservar el archivo y usar
**Descargar respaldo de emergencia** si la pantalla no abre.

La importación conserva por defecto la configuración y existencias ya editadas. En un equipo sin actividad,
el catálogo de demostración y la configuración inicial exactos pueden reemplazarse por los del respaldo.
La recuperación conserva el identificador del nuevo equipo; las ventas importadas conservan sus folios originales.

## Alcance de esta mejora

Ventas, historial, inventario, clientes VIP, cortes, devoluciones, garantías, movimientos de caja, ventas
pausadas, precios, configuración y reportes operativos usan IndexedDB. Las copias auxiliares también se
guardan fuera del espacio pequeño de LocalStorage. Los metadatos pequeños de acceso e identidad siguen
en LocalStorage. No hay capacidad ilimitada: la base local y los archivos necesitan espacio en disco.
Un error de cuota o de permisos se informa sin anunciar una operación no confirmada como completada.

No se ejecuta una restauración de fábrica ni una reparación automática que cambie los folios históricos.
Los respaldos antiguos siguen siendo entradas de importación; los archivos de emergencia con `rawStorage`
se recuperan usando sus valores originales cuando las tablas tienen un esquema válido.

## Verificación de desarrollo

Pruebas en perfiles de Chromium aislados, con Node y Playwright disponibles:

- `tests/storage-full.cjs`: cuota llena, corte, datos preservados, recarga y respaldo de emergencia.
- `tests/backup-safety.cjs`: descarga mensual, recuperación en navegador nuevo, importación repetida,
  diferencias, errores de escritura, copias de archivo independientes y fallos de disco.
- `tests/indexed-storage.cjs`: migración con almacenamiento lleno, comparación literal y originales,
  venta e inventario VIP atómicos, fallo y doble envío de cobro, dos pestañas concurrentes, corte fallido,
  recuperación completa, interrupción de migración, comprobación de integridad y movimientos del negocio.
- `tests/cut-backup.cjs`: cierre como empleada, cola de respaldos, archivo completo del corte, lectura
  verificada y descarga de seguridad ante carpeta no configurada, permisos, disco o verificación fallidos.

Las pruebas no acceden a los datos del cliente. La carpeta elegida por el cliente se configura únicamente
desde su propia computadora; los manejadores de archivos usados en las pruebas son simulados.
# Historial mensual: primera etapa sin retirar datos

La actualización `20261102-month1` no elimina ventas, clientes VIP, inventario,
datos originales de migración ni otros registros del navegador. Tampoco habilita
un botón de limpieza. Todavía no libera espacio mediante archivo histórico.

En Configuración, el administrador puede elegir una carpeta. El programa pide
permiso de escritura y verifica una primera copia completa. Si el navegador no
puede recordar el permiso, avisa que la selección sólo dura esa sesión. Una
descarga JSON ordinaria sigue llegando al destino de descargas del navegador:
no se redirige por haber elegido una carpeta para el respaldo automático.

Al elegir carpeta y después de cada corte con un JSON completo verificado, se
intenta crear una generación adicional en `Historial_mensual/FECHA_UUID/`:

- `Respaldo_completo.json`: todos los datos, incluidos los VIP y sus puntos.
- `AAAA-MM.json`: ventas e historial del período, sin cambiar registros.
- `sin-fecha.json`, cuando procede: conserva entradas sin fecha utilizable.
- `Indice.json`: cantidades, identidad y huellas SHA-256; se escribe al final.

Cada generación conserva las anteriores. El sistema nunca reemplaza un mes
anterior con una versión más corta. El puntero a la última copia sólo cambia
cuando todos los archivos se han vuelto a leer y verificar. Un corte sigue
guardado aunque falle esta copia mensual; se informa del resultado aparte.

“Crear copia por meses” permite ejecutar el proceso manualmente. “Verificar y
consultar meses” lee la última generación de la carpeta configurada, verifica
índice, archivos y coincidencia con el respaldo completo, y permite consultar
12 meses de un año. Muestra ventas netas y piezas descontando devoluciones de
las ventas correspondientes, excluye cancelaciones y presenta los productos
más vendidos por piezas antes de devoluciones. Es una consulta de la fecha de
la copia, no de movimientos posteriores. Registros sin fecha quedan señalados.
Si falta o cambia un archivo, no se ofrece un reporte parcial como completo.

Los reportes habituales siguen leyendo el historial completo del navegador:
no se mezclan con estas copias y no se duplican ventas. La consulta mensual usa
archivos sólo al solicitarla. La lectura de la última generación requiere el
puntero conservado en este navegador; si se pierde, el JSON completo permite
la recuperación por el importador existente. No borre datos para probarlo.

“Guardar respaldo y enviar correo” primero verifica otro respaldo completo del
corte (o solicita la descarga si la carpeta falla) y luego intenta el correo.
Los resultados aparecen separados, incluyendo correo pendiente. Reintentar no
crea otro corte. El envío sigue requiriendo pulsar el botón; no se envía solo.

Prueba adicional: `tests/monthly-archive.cjs`, con datos ficticios y manejadores
de carpeta simulados; no valida los permisos de la computadora del cliente.
