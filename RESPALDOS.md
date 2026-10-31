# Respaldos de Joyería de Luna

## Activar una carpeta en la computadora del negocio

1. En Chrome o Edge, iniciar sesión como administrador y abrir Configuración → Respaldos del negocio.
2. Elegir **Elegir carpeta de respaldos**, seleccionar una carpeta y permitir el acceso.
3. Confirmar que el estado indique ACTIVO y muestre la fecha del último guardado verificado.
4. Si aparece EN PAUSA, presionar **Reactivar permiso**. El navegador puede pedir el permiso otra vez al reiniciar.

Se crean archivos JSON completos y distintos, en subcarpetas por día. No se eliminan las copias anteriores.
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
Si falla una escritura durante la importación, se intenta revertir las escrituras realizadas en orden inverso.
Un mensaje de error no debe interpretarse como una recuperación terminada. Conservar el archivo y usar
**Descargar respaldo de emergencia** si la pantalla no abre.

La importación conserva por defecto la configuración y existencias ya editadas. En un equipo sin actividad,
el catálogo de demostración y la configuración inicial exactos pueden reemplazarse por los del respaldo.
La recuperación conserva el identificador del nuevo equipo; las ventas importadas conservan sus folios originales.

## Alcance de esta mejora

Las copias auxiliares se guardan y verifican en IndexedDB, sin volver a llenar LocalStorage con duplicados.
Las tablas operativas de ventas, inventario y clientes todavía usan LocalStorage. Esta versión **no** realiza
una migración completa de esas tablas a IndexedDB ni promete capacidad ilimitada. Un archivo que supera
el espacio disponible del almacenamiento operativo puede requerir esa migración antes de importarse.

No se ejecuta una restauración de fábrica ni una reparación automática que cambie los folios históricos.
Los respaldos antiguos siguen siendo entradas de importación; los archivos de emergencia con `rawStorage`
se recuperan usando sus valores originales cuando las tablas tienen un esquema válido.

## Verificación de desarrollo

Pruebas en perfiles de Chromium aislados, con Node y Playwright disponibles:

- `tests/storage-full.cjs`: cuota llena, corte, datos preservados, recarga y respaldo de emergencia.
- `tests/backup-safety.cjs`: descarga mensual, recuperación en navegador nuevo, importación repetida,
  diferencias, errores de escritura, copias de archivo independientes y fallos de disco.

Las pruebas no acceden a los datos del cliente. La carpeta elegida por el cliente se configura únicamente
desde su propia computadora; los manejadores de archivos usados en las pruebas son simulados.
