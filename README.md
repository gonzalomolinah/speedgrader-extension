# Canvas Corrector Helper

MVP de extension Chrome Manifest V3 para ayudar a corregir en Canvas SpeedGrader. Agrega un panel flotante en `https://cursos.canvas.uc.cl/*` cuando la URL contiene `speed_grader`, permite organizar criterios por secciones, calcula subtotales y escribe el total general en el campo visible de calificacion.

## Archivos

- `manifest.json`: configuracion Manifest V3.
- `content.js`: panel, secciones, criterios, persistencia, calculo, busqueda del input de Canvas e insercion del puntaje.
- `styles.css`: estilos del panel flotante.

## Instalacion

1. Abre `chrome://extensions`.
2. Activa el modo desarrollador.
3. Haz clic en `Cargar descomprimida`.
4. Selecciona esta carpeta del proyecto.
5. Abre Canvas SpeedGrader en una URL como:

```text
https://cursos.canvas.uc.cl/courses/.../gradebook/speed_grader?assignment_id=...
```

Si ya tenias la extension cargada, presiona el boton de recargar en la tarjeta de la extension y luego recarga SpeedGrader.

## Uso

1. En SpeedGrader deberia aparecer el panel `Corrector Canvas` en la esquina inferior derecha.
2. Crea secciones, por ejemplo `Parte A` y `Parte B`.
3. Dentro de cada seccion, agrega criterios con su puntaje.
4. Marca los criterios logrados por el estudiante.
5. Revisa el subtotal de cada seccion y el total general.
6. Presiona `Ingresar en Canvas` para escribir solo el total general en la casilla de calificacion visible.
7. Usa `Cerrar` para ocultar el panel cuando estorbe. Para volver a mostrarlo, presiona `Abrir Corrector Canvas`.
8. Revisa manualmente el puntaje en Canvas antes de entregar la evaluacion.

El boton `Limpiar` desmarca todos los criterios. El boton `Copiar total` copia solo el numero del total general al portapapeles como respaldo. Cerrar y reabrir el panel no borra la seleccion actual de la pagina.

## Persistencia

Las secciones y sus criterios se guardan en `chrome.storage.local` usando una key por curso y tarea:

```text
canvasCorrector:<courseId>:<assignmentId>
```

Si no se puede extraer el curso o la tarea desde la URL, se usa:

```text
canvasCorrector:default
```

La seleccion marcada no se guarda: cada carga parte con todos los criterios desmarcados. Si habia criterios guardados con la version anterior, la extension los migra automaticamente a una seccion llamada `General`.

## Pruebas manuales sugeridas

- Abrir SpeedGrader y confirmar que el panel aparece solo cuando la URL contiene `speed_grader`.
- Crear secciones como `Parte A` y `Parte B`.
- Agregar criterios con puntajes enteros y decimales, por ejemplo `2.5`.
- Marcar criterios en distintas secciones y confirmar que cambia cada subtotal y el total general.
- Cerrar el panel y volver a abrirlo con `Abrir Corrector Canvas`.
- Editar y eliminar secciones y criterios, luego recargar para verificar persistencia.
- Presionar `Limpiar` y confirmar que todos los subtotales vuelven a `0 pts`.
- Presionar `Copiar total` y pegar el resultado en un campo de texto temporal.
- Presionar `Ingresar en Canvas` y confirmar que el total general aparece en la casilla correcta.
- Revisar que la evaluacion no se entrega automaticamente.

## Advertencias

- Prueba primero con cuidado en un caso de bajo riesgo.
- La extension solo calcula e ingresa el puntaje total; no presiona automaticamente `Entregar evaluacion`.
- Si Canvas cambia su HTML, puede que haya que ajustar `findGradeInput()`.
