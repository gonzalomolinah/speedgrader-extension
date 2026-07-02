# Canvas Corrector Helper

Extension de Chrome para corregir mas rapido en Canvas SpeedGrader. Agrega un
panel flotante donde puedes armar tu pauta, marcar criterios, ver subtotales y
pasar esos puntajes a la rubrica visible de Canvas.

Tambien incluye un modo remoto para usar el panel desde otro dispositivo en la
misma red, por ejemplo un tablet o un segundo computador.

## Que hace

- Te deja crear una pauta por secciones y criterios.
- Calcula subtotales por seccion y el total general.
- Te ayuda a copiar esos subtotales a la rubrica de Canvas.
- Guarda la pauta para reutilizarla despues.
- Permite corregir desde otro dispositivo con el modo remoto.

## Instalacion rapida

### Extension

1. Abre Chrome.
2. Entra a `chrome://extensions`.
3. Activa `Modo desarrollador`.
4. Haz clic en `Cargar descomprimida`.
5. Selecciona la carpeta de este proyecto.
6. Abre Canvas SpeedGrader.

Si modificas el codigo, recarga la extension en `chrome://extensions` y luego
recarga SpeedGrader.

### Modo remoto

Solo lo necesitas si quieres usar el panel desde otro dispositivo.

- Ten Node.js instalado.
- Desde la raiz del proyecto ejecuta:

```powershell
node remote-server/server.js
```

No hace falta `npm install`.

## Tutorial rapido

### 1. Abre SpeedGrader

La extension funciona dentro de `https://cursos.canvas.uc.cl/` cuando estas en
una pagina de `speed_grader`.

Al abrir SpeedGrader deberia aparecer el panel `Corrector Canvas`.

### 2. Crea tu pauta

1. Activa `Editar`.
2. Agrega una seccion, por ejemplo `Parte A`.
3. Dentro de la seccion, agrega criterios con nombre y puntaje.
4. Repite lo mismo para las otras secciones.
5. Cuando termines, desactiva `Editar`.

### 3. Corrige al estudiante

1. Marca los criterios logrados.
2. Si toda una seccion aplica, puedes marcar o desmarcar la seccion completa.
3. Revisa los subtotales por seccion.
4. Revisa el `Total`.

### 4. Pasa los puntajes a Canvas

1. Deja visible la rubrica de Canvas.
2. Presiona `Ingresar en rubrica`.
3. Revisa que los puntajes hayan quedado bien antes de entregar la evaluacion.

### 5. Cambia de estudiante

Usa `Limpiar` para borrar la seleccion actual y empezar la siguiente correccion.

## Funciones disponibles

### Panel principal

- Muestra un panel flotante dentro de SpeedGrader.
- Se puede mover dentro de la pantalla.
- Se puede agrandar o achicar.
- Se puede cerrar y volver a abrir con `Abrir Corrector Canvas`.
- Recuerda si el panel quedo cerrado.

### Edicion de pauta

- Crear secciones.
- Renombrar secciones.
- Eliminar secciones.
- Crear criterios dentro de cada seccion.
- Renombrar criterios.
- Eliminar criterios.
- Usar puntajes enteros o decimales.
- Aceptar decimales con punto o coma.
- Guardar la pauta automaticamente.

### Correccion

- Marcar o desmarcar criterios individualmente.
- Marcar o desmarcar una seccion completa.
- Ver subtotal por seccion.
- Ver total general.
- Limpiar toda la seleccion actual.

### Integracion con Canvas

- Escribir los subtotales en los campos visibles de la rubrica.
- Mostrar mensajes si la rubrica no esta visible o no se encontraron los
  campos correctos.

### Modo remoto

- Activar o desactivar el modo remoto desde el panel.
- Mostrar una URL para abrir el control remoto en otro dispositivo.
- Corregir desde celular, tablet o segundo computador.
- Ver la misma pauta y el mismo total en tiempo real.
- Marcar criterios desde el dispositivo remoto.
- Marcar secciones completas desde el dispositivo remoto.
- Limpiar la seleccion desde el dispositivo remoto.
- Ejecutar `Ingresar en rubrica` desde el dispositivo remoto.
- Editar la pauta desde el panel web remoto.
- Ocultar el bloque `Modo remoto` y volver a mostrarlo con el boton `Remoto`.

## Que se guarda y que no

Se guarda:

- la pauta;
- los nombres de secciones;
- los nombres de criterios;
- los puntajes.

No se guarda:

- que criterios marcaste para un estudiante;
- los subtotales actuales;
- el total actual.

## Tutorial del modo remoto

1. En el computador principal, abre SpeedGrader.
2. En una terminal, ejecuta `node remote-server/server.js`.
3. En el panel de Canvas, activa `Modo remoto`.
4. Abre la URL que aparece en otro dispositivo de la misma red.
5. Usa ese panel remoto para marcar, editar o limpiar.
6. Cuando termines, desactiva el modo remoto.
7. Cierra el servidor con `Ctrl+C`.

## Notas importantes

- El modo remoto funciona en la misma red local. No esta pensado para internet.
- Canvas debe seguir abierto en el computador principal.
- `Ingresar en rubrica` no reemplaza la revision manual final.
- La extension ayuda a llenar la rubrica, pero igual conviene revisar todo antes
  de entregar la evaluacion.

## Problemas comunes

### El panel no aparece

- Verifica que estas en `https://cursos.canvas.uc.cl/`.
- Verifica que la URL sea de `speed_grader`.
- Recarga la extension y luego la pagina.

### `Ingresar en rubrica` no funciona

- Asegurate de que la rubrica este visible.
- Revisa si Canvas permite editar esos campos en ese momento.

### El remoto no conecta

- Confirma que el servidor esta corriendo.
- Confirma que SpeedGrader esta abierto en el computador principal.
- Activa `Modo remoto` en el panel.
- Usa la URL que muestra el panel, no `localhost`, desde el otro dispositivo.
