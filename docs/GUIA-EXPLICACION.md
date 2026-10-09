# Guia para entender y explicar el proyecto

## Objetivo

Recibir una imagen por HTTPS, guardar su original y generar de forma asincrona un
PNG circular de 40 x 40 pixeles con fondo transparente. La misma infraestructura
se puede crear en DEV, QA y PROD con Terraform.

## Recorrido de una imagen

1. El cliente envia `POST /upload` con JSON base64 o multipart.
2. API Gateway llama a `src/upload/index.js`. La funcion valida el archivo y lo
   guarda bajo `uploads/` en un bucket S3 privado. Responde 202: aceptado para procesar.
3. S3 envia una notificacion a SQS. Solo se notifican originales en `uploads/`,
   evitando que las imagenes procesadas provoquen un ciclo infinito.
4. El event source mapping de Lambda lee SQS y llama a `src/crop/index.js`.
5. Sharp orienta la imagen, la ajusta a 40 x 40, aplica una mascara circular y
   guarda el PNG bajo `processed/`. Lambda elimina los mensajes exitosos.
6. Si un mensaje falla, se reintenta. Tras tres recepciones fallidas pasa a la DLQ.
   Una alarma CloudWatch publica en SNS cuando hay mensajes visibles en esa DLQ.

SQS permite que la carga termine rapido aunque el recorte tarde. Un HTTP 202 no
demuestra por si solo que el recorte funciono: las pruebas descargan el PNG final.

## Por que existen los recursos de red

Las Lambdas usan dos subredes privadas en distintas zonas de disponibilidad. No
aceptan conexiones entrantes. Sus grupos de seguridad permiten HTTPS hacia S3 y
el endpoint SQS. El endpoint Gateway de S3 permite llegar a S3 sin atravesar un NAT.
El endpoint Interface de SQS tiene direcciones privadas en las dos zonas.

Los dos NAT Gateways y sus IP publicas reproducen el diagrama. Cada subred privada
usa el NAT de su propia zona; no hay conmutacion automatica entre NATs. Estos recursos
consumen creditos incluso sin subir imagenes, por eso se destruyen despues de probar.

## Permisos y datos

IAM da a upload permiso para escribir originales. Crop puede leer originales,
escribir procesados y consumir la cola. Los roles tambien permiten logs y la
conexion de Lambda a la VPC. El bucket bloquea acceso publico, cifra con AES-256
y exige TLS. El versionado conserva versiones; los lifecycle rules expiran
originales a 30 dias y procesados a 90 dias.

La API no tiene autenticacion porque el diagrama no la define. PROD es el nombre
de un entorno de esta practica, no una certificacion de seguridad para uso comercial.

## Terraform y entornos

El modulo `terraform/modules/image-processor/` contiene los recursos. Cada raiz
en `terraform/environments/` tiene su configuracion y estado independiente.
Los nombres incluyen el entorno para evitar colisiones.

- `plan` consulta AWS y muestra cambios; no crea la arquitectura.
- `apply` ejecuta el plan y devuelve los identificadores y endpoint.
- `verify` sube imagenes reales y comprueba el resultado privado.
- `destroy` elimina los recursos registrados en el estado del entorno.

No se borra el archivo de estado antes de destruir: Terraform lo necesita para
saber que recursos administra. Las capturas deben mostrar resultados reales.

## Limite que debes explicar

API Gateway admite 10 MB, pero la invocacion sincrona de Lambda admite 6 MB y el
base64 aumenta el tamano. Por eso `/upload` limita el archivo a 4 MiB. La ruta
adicional `/upload-url` firma un POST directo a S3 de hasta 10 MiB. S3 mantiene
su privacidad y luego usa la misma cola y el mismo recorte. Esta adaptacion se
declara expresamente; no se afirma que un archivo de 10 MiB atraviese `/upload`.

Node.js 20 sigue el diagrama, pero esta deprecado. El runtime es configurable
para actualizarlo si AWS lo exige o el docente lo permite. Una alarma SNS sin
suscripcion de email no entrega correos; una suscripcion requiere confirmacion.

## Como demostrar que funciona

Las ocho pruebas locales comprueban validacion, multipart, firma y recorte real.
Las pruebas contra AWS comprueban JSON, multipart, carga firmada y un PNG valido
de 10 MiB por S3. El resultado debe tener 40 x 40 pixeles, alfa 0 en la esquina
y alfa 255 en el centro. Los logs y los objetos S3 conectan la entrada con la salida.

La limpieza se demuestra con `terraform destroy`, estado vacio y consultas AWS
que confirmen que los recursos ya no existen. Un repositorio publicado no prueba
por si solo que hubo un despliegue.

## Preparacion para la revision

Lee los dos handlers y relaciona cada recurso Terraform con el diagrama. Practica
explicar por que se usa SQS, que pasa con un archivo corrupto y como se elimina
el entorno. Consulta el estado real antes de afirmar que se completo una prueba.
El historial Git registra el trabajo realizado; no se modifican fechas ni se crean
commits artificiales para aparentar una duracion diferente. Declara la asistencia
utilizada conforme a las reglas de tu curso.
