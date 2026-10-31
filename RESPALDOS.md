# Respaldos de Joyería de Luna

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
