# Checklist del PDF final

1. Portada: autor, curso, titulo, fecha y URL real del repositorio.
2. Explicacion breve y diagrama del flujo implementado.
3. Declarar ruta complementaria para 10 MiB, limite directo de 4 MiB y runtime usado.
4. Captura de cuenta AWS y region us-east-1; no mostrar contrasenas ni claves.
5. Por DEV, QA y PROD:
   - Terraform apply exitoso y outputs identificados por entorno.
   - API Gateway POST /upload y configuracion Lambda.
   - VPC, subredes multi-AZ, dos NAT Gateways y endpoints.
   - S3 privado y ejemplos uploads/ y processed/.
   - Respuesta de carga, imagen original y PNG circular 40x40 con transparencia.
   - CloudWatch logs de imagen procesada.
   - Cola principal, DLQ, alarma y accion SNS.
   - Terraform destroy exitoso, estado vacio y ausencia de los recursos.
6. Guardar resultados de scripts y capturas originales para trazabilidad.
7. Confirmar que el repositorio se puede consultar por el evaluador y contiene README.

La imagen generada localmente es una entrada de prueba, no prueba de despliegue.
Capturas de plan, cuentas vacias o infraestructura pendiente no sustituyen apply,
pruebas end-to-end ni destroy.
