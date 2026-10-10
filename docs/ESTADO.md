# Estado actual

Fecha: 9 de octubre de 2026 (America/Lima).

- Codigo de Lambdas y Terraform: preparado.
- Entornos: DEV, QA, PROD con raices y estados independientes.
- Pruebas locales: 8 pruebas aprobadas.
- Validacion Terraform: DEV, QA y PROD validos; proveedor AWS 6.68.0 fijado para Windows y Linux.
- Despliegue AWS: DEV aplicado; 66 recursos creados. QA y PROD preparados para ejecucion secuencial.
- Pruebas reales DEV: JSON, multipart, carga firmada y PNG de 10 MiB aprobados; salida circular 40x40 con transparencia.
- Evidencias DEV: descargadas; terraform destroy en curso, pendiente de retirar interfaces de red de Lambda.
- Correccion de limpieza: los grupos de seguridad conservan los permisos IAM de VPC hasta terminar de retirar las interfaces.
- Evidencias QA y PROD: pendientes de despliegue, pruebas y destruccion reales.
- URL del repositorio: https://github.com/jordan4-debug/aws-image-processor (publicado).
- PDF final de evidencias: pendiente de las capturas y la URL reales.

No afirmar que el sistema esta desplegado hasta tener `apply` exitoso y pruebas
contra el endpoint real. No afirmar destruccion completa sin estado vacio y
comprobacion de los recursos en AWS.
