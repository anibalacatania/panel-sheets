# Panel Sensorial por Sesiones

App web para análisis sensorial con varias sesiones por panelista (grupos de vinos y repeticiones).

- **App de panelistas:** https://anibalacatania.github.io/panel/
- **Administración:** https://anibalacatania.github.io/panel/#admin
- **Datos:** planilla de Google “Panel Sensorial Sesiones - Datos” (la clave de administrador está en la hoja **Config**)

## Cómo se usa

### 1. Armar el estudio (administrador)
1. Entrá a `#admin` con la clave.
2. Pegá la lista de vinos (uno por línea, se puede copiar una columna de Excel).
3. Elegí **repeticiones**, **vinos por sesión** y **número de panelistas**.
4. **Generar vista previa** → revisá las sesiones y los códigos → **Guardar y publicar**.

Conceptos:
- **Repetición** = cuántas veces pasa cada vino por el panel. 8 vinos × 3 repeticiones = 24 muestras.
- **Sesión** = cada reunión con los panelistas. Las muestras se reparten de a “vinos por sesión”:
  24 de a 6 → 4 sesiones; de a 8 → 3; de a 4 → 6; de a 7 → 7+7+7+3
  (con “repartir parejo”: 6+6+6+6).
- Un mismo vino **nunca se repite dentro de una sesión** (sus repeticiones caen en reuniones distintas),
  por eso los vinos por sesión no pueden superar la cantidad de vinos distintos.
- Dentro de cada sesión, el orden de presentación por panelista sigue un **cuadrado de Williams**
  (balancea posición y vino anterior), con un mapeo aleatorio por cada bloque de panelistas.
- Cada muestra (vino × repetición) recibe un **código de 3 dígitos** único en todo el estudio.
- Con la misma **semilla** y los mismos datos se obtiene exactamente el mismo diseño.
- Para balance completo, el número de panelistas debería ser múltiplo de n (si la sesión tiene n vinos, n par)
  o de 2n (n impar). La app avisa.
- En **Respuestas** cada fila trae `NombreProducto` y `Rep` (la repetición de ese vino), listos para el análisis.

Si ya hay respuestas y se guarda un diseño nuevo, la hoja **Respuestas** no se borra: se renombra como respaldo.

### 2. Panelistas
- Eligen su número → ven todas sus sesiones → entran a la que quieran.
- Cada muestra se guarda en la planilla al tocar “Enviar y continuar”. Sin internet, quedan pendientes y se suben solas.
- Si salen a mitad de una sesión, al volver continúan donde quedaron.
- Al completar una sesión queda **deshabilitada** (✔ Completada).

### 3. Durante el panel (administrador)
- **Progreso:** tabla panelista × sesión (✔ completa, n/N en curso).
- **Planilla de servicio:** por sesión, vino → repetición → código y la bandeja de cada panelista en orden. Botón **Imprimir**.

## Hojas de la planilla
| Hoja | Contenido |
|---|---|
| Config | ClaveAdmin, Estudio |
| Atributos | un atributo por fila |
| Sesiones | Sesion, NMuestras, Vinos |
| Diseno | Sesion, Valuador, Orden, NombreProducto, Rep, CodigoProducto |
| Respuestas | una fila por muestra evaluada + un atributo por columna |

## Archivos
- `index.html` — la app ya compilada (**no editar a mano**: se genera desde `src/`)
- `src/app.jsx` — código fuente de la app
- `src/estilos.css`, `src/plantilla.html` — estilos y plantilla
- `src/build.mjs` — genera `index.html`
- `config.json` — URL del script de Google (se lee sin caché)
- `Codigo.gs` — copia del script que está en la planilla (Extensiones → Apps Script)

## Modificar la app
La app se publica precompilada para que abra rápido (el navegador no tiene que traducir el código).
Después de editar `src/app.jsx`:

```bash
npm i -D @babel/core @babel/preset-react @babel/preset-env tailwindcss@3 terser
node src/build.mjs
```
y subir el `index.html` nuevo.

## Velocidad
- La planilla guarda el diseño 10 minutos en la memoria rápida de Google. Si editás a mano las hojas
  Diseno, Sesiones o Atributos, ejecutá `refrescarMemoria` desde el editor de Apps Script (o esperá 10 min).
- La primera llamada después de un rato sin uso tarda unos segundos más (Google “despierta” el script).
- La app guarda en el dispositivo la última copia del diseño y la muestra al instante mientras se actualiza.
- Los nombres de los vinos no se envían a los dispositivos de los panelistas (cata a ciegas): el servidor los completa al guardar cada respuesta.
