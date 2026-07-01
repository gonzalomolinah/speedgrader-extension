# Canvas Corrector Helper

Extension de Chrome Manifest V3 para apoyar la correccion en Canvas
SpeedGrader. Agrega un panel flotante en `https://cursos.canvas.uc.cl/*`
cuando la URL contiene `speed_grader`, permite organizar una pauta por
secciones y criterios, calcula subtotales, calcula el total general y ayuda a
ingresar esos puntajes en Canvas.

El proyecto tambien incluye un servidor remoto liviano para usar el panel desde
otro dispositivo en la misma red. Canvas sigue abierto solo en el computador
principal; el otro dispositivo actua como control remoto.

## Tabla de contenidos

- [Que hace](#que-hace)
- [Requisitos](#requisitos)
- [Estructura del proyecto](#estructura-del-proyecto)
- [Instalacion de la extension](#instalacion-de-la-extension)
- [Uso en SpeedGrader](#uso-en-speedgrader)
- [Ingreso de puntajes en Canvas](#ingreso-de-puntajes-en-canvas)
- [Persistencia de datos](#persistencia-de-datos)
- [Servidor remoto](#servidor-remoto)
- [Cambiar puerto u host](#cambiar-puerto-u-host)
- [Seguridad y privacidad](#seguridad-y-privacidad)
- [Troubleshooting](#troubleshooting)
- [Pruebas manuales sugeridas](#pruebas-manuales-sugeridas)

## Que hace

- Muestra un panel `Corrector Canvas` dentro de SpeedGrader.
- Permite crear secciones, por ejemplo `Parte A`, `Parte B` o `Informe`.
- Permite agregar criterios dentro de cada seccion, con nombre y puntaje.
- Acepta puntajes enteros y decimales. Tambien acepta coma decimal al guardar.
- Permite marcar criterios logrados por cada estudiante.
- Permite marcar o desmarcar una seccion completa desde su encabezado.
- Calcula el subtotal de cada seccion y el total general.
- Copia el total al portapapeles como respaldo.
- Intenta escribir subtotales en los campos visibles de rubrica de Canvas.
- Intenta escribir el total general en el input visible de calificacion.
- No entrega la evaluacion automaticamente.
- Opcionalmente sincroniza el panel con otro dispositivo en la misma red.

## Requisitos

- Google Chrome o un navegador Chromium compatible con extensiones Manifest V3.
- Acceso a Canvas en `https://cursos.canvas.uc.cl/`.
- Una pagina de SpeedGrader cuya URL contenga `speed_grader`.
- Node.js para usar el servidor remoto.

El servidor remoto no requiere `npm install`: usa solo modulos nativos de Node.

## Estructura del proyecto

```text
.
|-- manifest.json
|-- content.js
|-- styles.css
|-- remote-server/
|   |-- server.js
|   `-- public/
|       |-- index.html
|       |-- remote.css
|       `-- remote.js
`-- README.md
```

- `manifest.json`: configuracion de la extension, permisos y content script.
- `content.js`: logica principal del panel, calculo, persistencia, escritura en
  Canvas y conexion con el servidor remoto.
- `styles.css`: estilos del panel flotante dentro de Canvas.
- `remote-server/server.js`: servidor HTTP/WebSocket para el modo remoto.
- `remote-server/public/`: interfaz web que se abre desde el dispositivo remoto.

## Instalacion de la extension

1. Abre Chrome.
2. Entra a `chrome://extensions`.
3. Activa `Modo desarrollador`.
4. Haz clic en `Cargar descomprimida`.
5. Selecciona la carpeta raiz de este proyecto.
6. Confirma que aparezca la extension `Canvas Corrector Helper`.

Despues de modificar archivos de la extension, vuelve a `chrome://extensions`,
presiona el boton de recargar en la tarjeta de la extension y recarga
SpeedGrader.

## Uso en SpeedGrader

1. Abre una tarea en Canvas SpeedGrader. La URL debe parecerse a:

```text
https://cursos.canvas.uc.cl/courses/.../gradebook/speed_grader?assignment_id=...
```

2. El panel `Corrector Canvas` deberia aparecer en la esquina inferior derecha.
3. Si el panel molesta, arrastra su encabezado para moverlo.
4. Usa `Cerrar` para ocultarlo. Para volver a mostrarlo, usa
   `Abrir Corrector Canvas`.
5. Activa `Editar` para crear o modificar la pauta.
6. Agrega una seccion con su nombre.
7. Dentro de la seccion, agrega criterios con nombre y puntaje.
8. Desactiva `Editar` para corregir mas rapido.
9. Marca los criterios logrados por el estudiante. Puedes hacer clic en la fila
   completa, no solo en la casilla. Tambien puedes hacer clic en el encabezado
   de una seccion para marcarla o desmarcarla completa.
10. Revisa el subtotal de cada seccion y el total.
11. Usa `Limpiar` al cambiar de estudiante o cuando quieras desmarcar todo.
12. Usa `Copiar total` si quieres pegar el puntaje manualmente.
13. Usa `Ingresar en Canvas` para pedirle a la extension que escriba puntajes en
    los campos visibles de Canvas.

La seleccion marcada no se guarda entre recargas. La pauta si se guarda.

## Ingreso de puntajes en Canvas

El boton `Ingresar en Canvas` hace dos cosas:

1. Busca campos visibles de puntaje de rubrica y escribe los subtotales de las
   secciones en orden visual.
2. Busca el campo visible de calificacion general de SpeedGrader y escribe el
   total.

Ejemplo: si tienes secciones `Parte A`, `Parte B` y `Parte C`, la extension
intentara escribir:

- subtotal de `Parte A` en el primer campo visible de criterio de la rubrica;
- subtotal de `Parte B` en el segundo campo visible;
- subtotal de `Parte C` en el tercero;
- total general en el campo principal de calificacion.

Si Canvas no muestra una rubrica visible, la extension solo intentara escribir
el total general. Si no encuentra el input correcto, mostrara un mensaje de
error en el panel.

Importante: revisa siempre el puntaje en Canvas antes de entregar la evaluacion.
La extension no presiona botones de entrega ni publica calificaciones.

## Persistencia de datos

La pauta se guarda en `chrome.storage.local` con una clave por curso y tarea:

```text
canvasCorrector:<courseId>:<assignmentId>
```

Si no se puede extraer el curso o la tarea desde la URL, se usa:

```text
canvasCorrector:default
```

Se guarda:

- nombres de secciones;
- nombres de criterios;
- puntajes de criterios.

No se guarda:

- criterios marcados para un estudiante;
- subtotal actual;
- total actual.

Si habia datos guardados con una version anterior sin secciones, la extension
los migra automaticamente a una seccion llamada `General`.

## Servidor remoto

El modo remoto permite abrir el panel en otro dispositivo de la misma red, por
ejemplo un tablet o un segundo computador. Ese dispositivo puede marcar
criterios, limpiar la seleccion y pedir `Ingresar en Canvas`.

Canvas debe seguir abierto en el computador principal. El servidor remoto debe
correr en ese mismo computador principal, porque la extension se conecta a:

```text
ws://127.0.0.1:8787/extension
```

En otras palabras: este servidor es un puente local para la red, no un servidor
publico para correr en un VPS.

### Como iniciarlo

Desde la carpeta raiz del proyecto:

```powershell
node remote-server/server.js
```

La terminal deberia mostrar algo parecido a:

```text
Canvas Corrector remote server
Panel: http://192.168.1.23:8787
Panel: http://localhost:8787
Keep this process running while using remote mode.
```

Manten esa terminal abierta mientras uses el modo remoto.

### Como usarlo desde otro dispositivo

1. En el computador principal, abre Canvas SpeedGrader.
2. Asegurate de que la extension este cargada y el panel aparezca.
3. En otra terminal, ejecuta `node remote-server/server.js`.
4. En el panel `Corrector Canvas`, busca `Modo remoto`.
5. Presiona `Activar`.
6. El panel mostrara una URL de red, por ejemplo:

```text
http://192.168.1.23:8787
```

7. Abre esa URL desde el navegador del dispositivo remoto.
8. Marca criterios desde el dispositivo remoto.
9. Verifica que el total se sincronice con el panel dentro de Canvas.
10. Usa `Ingresar en Canvas` desde el remoto solo cuando estes listo para
    escribir los puntajes en el navegador principal.
11. Revisa manualmente Canvas antes de entregar.
12. Cuando termines, presiona `Desactivar` en `Modo remoto` y cierra el servidor
    con `Ctrl+C` en la terminal.

No abras `http://localhost:8787` desde el dispositivo remoto. En ese dispositivo,
`localhost` apunta al propio dispositivo, no al computador principal. Usa la IP
de red que imprime el servidor.

### Verificar estado del servidor

Puedes abrir esta URL en el computador principal:

```text
http://localhost:8787/health
```

Deberia devolver un JSON similar a:

```json
{
  "ok": true,
  "extensionConnected": true,
  "remoteClients": 1
}
```

- `extensionConnected: true` significa que el panel de Canvas esta conectado al
  servidor.
- `remoteClients` indica cuantos paneles remotos estan conectados.

### Estados comunes del panel remoto

- `Conectando`: el navegador remoto esta intentando abrir el WebSocket.
- `Esperando extension`: el servidor esta activo, pero la extension aun no se
  conecto. Abre SpeedGrader y activa `Modo remoto`.
- `Conectado`: el remoto ya recibe la pauta y puede controlar la seleccion.
- `Extension desconectada`: Canvas se recargo, la extension se desactivo o el
  modo remoto se apago.
- `Reconectando`: el navegador remoto intentara reconectarse automaticamente.

## Cambiar puerto u host

El puerto por defecto es `8787`. La extension y el manifest estan configurados
para ese puerto:

- `content.js`: `REMOTE_SERVER_URL = "ws://127.0.0.1:8787/extension"`
- `manifest.json`: permisos para `http://127.0.0.1:8787/*` y
  `http://localhost:8787/*`

Si solo ejecutas el servidor con otro puerto, la extension no se conectara. Para
cambiar el puerto debes:

1. Cambiar `REMOTE_SERVER_URL` en `content.js`.
2. Cambiar o agregar los permisos correspondientes en `manifest.json`.
3. Recargar la extension en `chrome://extensions`.
4. Ejecutar el servidor con el mismo puerto.

En PowerShell:

```powershell
$env:PORT = "8790"
node remote-server/server.js
```

En macOS o Linux:

```bash
PORT=8790 node remote-server/server.js
```

El host por defecto es `0.0.0.0`, lo que permite que otros dispositivos de la
red accedan al panel. Puedes cambiarlo con `HOST`, pero si usas `127.0.0.1` el
panel remoto solo funcionara en el mismo computador.

PowerShell:

```powershell
$env:HOST = "0.0.0.0"
node remote-server/server.js
```

macOS o Linux:

```bash
HOST=0.0.0.0 node remote-server/server.js
```

## Seguridad y privacidad

- Usa el modo remoto solo en redes confiables.
- El servidor remoto no tiene autenticacion.
- Cualquier persona en la misma red que abra la URL podria ver la pauta y enviar
  acciones al navegador principal mientras el modo remoto este activo.
- Los datos de la pauta se guardan localmente en Chrome.
- En modo remoto, la pauta y el estado actual viajan por la red local entre el
  computador principal y el dispositivo remoto.
- No expongas el puerto `8787` directamente a internet.
- No se recomienda usar este servidor en un VPS o servidor publico sin agregar
  autenticacion, HTTPS/WSS, configuracion explicita de origenes permitidos y una
  revision de seguridad.

El servidor rechaza conexiones de extension que no vengan de loopback para el
endpoint `/extension`. Esto evita que una extension externa controle el puente
desde otra maquina, pero no reemplaza una capa real de autenticacion para el
panel remoto.

## Troubleshooting

### El panel no aparece en Canvas

- Confirma que la URL contenga `speed_grader`.
- Recarga la extension en `chrome://extensions`.
- Recarga la pagina de SpeedGrader.
- Confirma que estas en `https://cursos.canvas.uc.cl/*`.
- Abre DevTools y revisa si hay errores del content script.

### Los cambios de codigo no se ven

- Recarga la extension en `chrome://extensions`.
- Recarga SpeedGrader.
- Si cambiaste `manifest.json`, la recarga de la extension es obligatoria.

### `Ingresar en Canvas` no escribe el puntaje

- Verifica que el campo de calificacion este visible en SpeedGrader.
- Verifica que la rubrica, si existe, este visible y editable.
- Prueba primero `Copiar total` y pega manualmente como respaldo.
- Si Canvas cambio su HTML, puede que haya que ajustar la logica de
  `findGradeInput()` o `findRubricCriterionInputs()` en `content.js`.

### El panel remoto dice `Esperando extension`

- Abre SpeedGrader en el computador principal.
- Confirma que el panel `Corrector Canvas` este visible.
- Presiona `Activar` en `Modo remoto`.
- Revisa `http://localhost:8787/health` y confirma
  `extensionConnected: true`.

### El otro dispositivo no abre la URL remota

- Usa la IP de red impresa por el servidor, no `localhost`.
- Confirma que ambos dispositivos esten en la misma red.
- En Windows, permite Node.js en el firewall para redes privadas.
- Verifica que la red este marcada como privada si corresponde.
- Confirma que el servidor siga corriendo en la terminal.
- Prueba abrir la URL desde el computador principal usando la IP de red.

### Cambie el puerto y dejo de conectar

- Asegurate de cambiar el puerto en `content.js`.
- Asegurate de cambiar los permisos en `manifest.json`.
- Recarga la extension.
- Reinicia el servidor con el mismo puerto.

## Pruebas manuales sugeridas

- Abrir una pagina normal de Canvas y confirmar que el panel no aparece.
- Abrir SpeedGrader y confirmar que el panel aparece.
- Crear secciones como `Parte A` y `Parte B`.
- Agregar criterios con puntajes enteros y decimales.
- Probar decimales con punto y con coma.
- Activar y desactivar `Editar`.
- Editar nombres de secciones y criterios.
- Eliminar secciones y criterios.
- Recargar SpeedGrader y confirmar que la pauta persiste.
- Confirmar que la seleccion marcada no persiste despues de recargar.
- Marcar criterios haciendo clic en la fila completa.
- Marcar y desmarcar una seccion completa haciendo clic en su encabezado.
- Confirmar que subtotales y total se actualizan correctamente.
- Usar `Limpiar` y confirmar que todo vuelve a cero.
- Usar `Copiar total` y pegar el valor en un campo temporal.
- Usar `Ingresar en Canvas` y revisar que los puntajes queden correctos.
- Confirmar que la evaluacion no se entrega automaticamente.
- Ejecutar `node remote-server/server.js`.
- Activar `Modo remoto` en el panel de Canvas.
- Abrir la URL de red desde otro dispositivo.
- Confirmar que el remoto recibe secciones, criterios y total.
- Marcar criterios desde el remoto y confirmar sincronizacion en Canvas.
- Usar `Limpiar` desde el remoto.
- Usar `Ingresar en Canvas` desde el remoto y revisar Canvas manualmente.
- Desactivar `Modo remoto` y confirmar que el panel remoto deja de controlar la
  seleccion.
