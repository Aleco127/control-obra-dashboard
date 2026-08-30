# Publicar la app en las tiendas (US-244)

La aplicación ya se instala desde el navegador como PWA (Android e iOS: "Agregar a la pantalla de inicio"). El envoltorio Capacitor de `mobile/` existe para publicarla además en Google Play, con icono, splash y cámara nativa.

## Estado

| Paso | Estado |
|---|---|
| Proyecto Capacitor (`mobile/package.json`, `capacitor.config.json`, `www/`) | Listo en el repo |
| Plataforma Android generada (`mobile/android/`) | **Pendiente**: requiere Android SDK; esta máquina no lo tiene instalado (`ANDROID_HOME` vacío) |
| AAB firmado y ficha de Play Console | Pendiente del paso anterior |
| iOS / App Store | Pendiente de una Mac (mismo bloqueo que la app de Mensajes de Zook) |

## Qué falta hacer y cómo

1. Instalar **Android Studio** (trae el SDK y `gradle`). Java 17 ya está instalado en esta máquina (`C:\Program Files\Microsoft\jdk-17.0.18.8-hotspot`).
2. En `mobile/`: `npm install` y `npx cap add android` (crea `mobile/android/`, que no se versiona: va en `.gitignore`).
3. Iconos y splash: `npx @capacitor/assets generate --android` usando `mobile/resources/icon.png` (512 px, el mismo del manifest de la PWA).
4. Permisos: la cámara la pide la web, pero Android necesita `CAMERA` y `READ_MEDIA_IMAGES` en `AndroidManifest.xml` (los agrega `@capacitor/camera` al sincronizar).
5. Firma: crear el keystore con `keytool -genkey -v -keystore control-obra.jks -alias obra -keyalg RSA -keysize 2048 -validity 10000` y guardarlo **fuera del repo** (VPS `/root/.obra_android_keystore` con permisos 600, respaldo en el gestor de contraseñas). Sin el keystore original no se pueden publicar actualizaciones.
6. Compilar: `npm run aab` (`android/app/build/outputs/bundle/release/app-release.aab`).
7. Play Console: cuenta de desarrollador (pago único de 25 USD), ficha con las capturas de `src/img/landing-*.png` y de `docs/qa/`, política de privacidad apuntando a https://app.supernovarquitectos.com/privacidad.html, y declaración de datos (correo, teléfono opcional, fotos que sube el propio usuario).

## Cómo se comporta el envoltorio

`capacitor.config.json` apunta `server.url` a https://app.supernovarquitectos.com, es decir la app de la tienda carga la misma aplicación web y se actualiza con cada despliegue, sin subir versión nueva a Play salvo que cambien icono, permisos o plugins. `www/index.html` sólo existe como respaldo si algún día se decide empaquetar la web dentro del APK.
