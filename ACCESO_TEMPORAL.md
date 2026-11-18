# Acceso administrador desde invitado

Implementación en `punto-de-venta-refactor`. No modifica ni migra ventas,
inventario, cortes, clientes VIP u originales al cargar la actualización.

1. Iniciar sesión como invitado y abrir la caja normalmente.
2. Pulsar **Acceso administrador** en la barra superior.
3. Introducir la contraseña de autorización. No se muestra la contraseña ni
   una sugerencia en la pantalla. Su valor inicial es el acordado con el dueño.
4. Con autorización, se habilitan Inventario, Reportes, Configuración y la
   edición del precio en el carrito. La identidad del cajero y del turno no cambian.
5. Pulsar **Desactivar acceso administrador** al terminar. La caja y el carrito
   permanecen abiertos. El precio especial autorizado se conserva para esa venta;
   no modifica el precio del catálogo. Se respetan las piezas gratis del Buen Fin.

El permiso sólo vive en memoria en esa pestaña y queda ligado al usuario y al
turno. Se retira al cerrar caja, salir, recargar o abandonar la página. Cambios
de sesión, turno o contraseña desde otra pestaña también lo retiran. Un cierre
de caja que no pudo confirmarse conserva la caja abierta.

## Cambio de contraseña

Iniciar sesión **directamente como administrador**, abrir la caja como
administrador y entrar a Configuración → **Contraseña de acceso administrador
para invitados**. Escribir contraseña actual, nueva y confirmación, y pulsar
**Cambiar contraseña de autorización**.

Una sesión de invitado con autorización temporal conserva este apartado
deshabilitado. La comprobación también se realiza al guardar; habilitar un botón
en la pantalla no permite saltarla. Las contraseñas de inicio de administrador y
cajero siguen reservadas a la sesión directa de administrador.

La nueva contraseña de autorización usa una clave de acceso separada, mediante
SafeStorage. El valor inicial se usa como respaldo sin escribir ni sustituir
las credenciales ni los registros existentes. El permiso temporal nunca se exporta.

## Pruebas

`tests/guest-admin-access.cjs` usa perfiles aislados y datos ficticios. Verifica
contraseñas incorrectas, activación y bloqueo desde la interfaz, conservación
exacta de registros y turno, modificación de stock, precio especial sólo para
la venta, promociones, restricción de credenciales, recarga, cierre fallido y
exitoso, nuevo turno, cambio de contraseña y revocación entre pestañas.

Las pruebas existentes de almacenamiento, recuperación y respaldo del corte
continúan aplicándose. No se usan los registros del cliente para estas pruebas.
