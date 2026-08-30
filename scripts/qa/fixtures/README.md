
## csd_prueba.cer

Certificado X.509 autofirmado que imita un CSD del SAT: número de serie de 20 dígitos guardado como ASCII
dentro del INTEGER y el RFC en el subject (`x500UniqueIdentifier`). Sirve para probar el lector de
`supabase/functions/pac-config/certificado.js` sin usar un sello real. La llave privada NO se versiona:
si la necesitas para una prueba manual, regenera el par con

    openssl req -x509 -newkey rsa:2048 -keyout csd_prueba.key.pem -out csd_prueba.cer -outform DER \
      -days 400 -nodes -set_serial 0x3330303031303030303030353030303033343536 \
      -subj "/CN=SUPERNOVA ARQUITECTOS SA DE CV/x500UniqueIdentifier=SAR250213IS1"
