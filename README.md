# Descarga Masiva CFDI SAT

Este proyecto permite autenticarse en el portal del SAT, realizar consultas de CFDI y descargar los archivos resultantes. El backend se basa en PHP y la librería **phpcfdi/cfdi-sat-scraper**, mientras que la interfaz se encuentra en `mi-frontend/` y se comunica mediante JavaScript.

## Flujo de trabajo
1. **Iniciar sesión**: desde la interfaz introduce tu RFC y contraseña CIEC y pulsa **Login SAT**. El sistema resolverá el captcha utilizando BoxFacturaAI y mantendrá una sesión activa.
2. **Realizar consultas**: selecciona el tipo de CFDI, el periodo de búsqueda y los filtros disponibles. Con el botón **Buscar** obtendrás la lista de comprobantes.
3. **Descargar archivos**: puedes marcar los CFDI deseados y usar **Descargar** o bien **Buscar y descargar** para realizar ambas operaciones en un paso. Los XML o PDF se guardarán en la carpeta `descarga/`.
4. **Cerrar la sesión**: al finalizar presiona **Logout SAT**.

## Instalación
### Backend
1. Requiere PHP 8 y Composer.
2. Ejecuta en `api/`:
   ```bash
   composer install
   ```
3. Verifica que la ruta `descarga/` (en la raíz del proyecto) tenga permisos de escritura.

### Frontend
El frontend no necesita compilación. Los archivos están en `mi-frontend/`. Si el backend se publica en otra ubicación, ajusta la constante `API_URL` en `js/cfdi-api.js`.

## Ejecución
### Backend
Desde la raíz del repositorio inicia el servidor integrado de PHP para exponer tanto la API como el frontend:
```bash
php -S localhost:8000 -t .
```

### Frontend
Accede a `http://localhost:8000/mi-frontend/index.html` con tu navegador.


