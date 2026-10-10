# Estado actual

Fecha: 9 de octubre de 2026 (America/Lima).

- Codigo de las dos Lambdas y Terraform: implementado.
- Entornos: DEV, QA y PROD con raices y estados independientes.
- Pruebas locales: 8 aprobadas, tambien ejecutadas en CloudShell.
- Validacion Terraform: las tres raices validas; proveedor AWS 6.68.0 fijado para Windows y Linux.
- Despliegues reales: 66 recursos creados por entorno; 198 en total.
- Pruebas reales: 12 aprobadas, cuatro por entorno (JSON, multipart, carga firmada y PNG valido de 10 MiB).
- Resultados: PNG circular 40x40, esquina transparente y centro opaco, descargado del bucket privado.
- DEV, QA y PROD: terraform destroy completo; 66 recursos eliminados por entorno, 198 en total.
- Limpieza comprobada: estados Terraform vacios y ausencia posterior de los recursos mediante consultas AWS en los tres entornos.
- Limpieza: los grupos de seguridad conservan los permisos IAM de VPC hasta retirar las interfaces.
- Repositorio publico con README: https://github.com/jordan4-debug/aws-image-processor.
- Evidencias para el PDF: capturas de cuenta, despliegues, pruebas, logs y limpieza completas para los tres entornos. El informe y los archivos de cuenta se entregan por separado del repositorio publico.

Los entornos se probaron por separado; los NAT del anterior se retiraron antes
de crear el siguiente. La liberacion asincrona de las interfaces Lambda puede
solaparse. Las APIs temporales ya no estan activas tras la destruccion; el enlace
del proyecto y las instrucciones se conservan en este repositorio.

Se declara la ruta complementaria a S3 para 10 MiB y el limite de 4 MiB en
`/upload`. La configuracion DLQ/alarma fue consultada; no se provoco el ensayo
opcional de fallo ni se acredita entrega de email SNS. Las evidencias con datos
de cuenta se mantienen fuera del repositorio publico.
