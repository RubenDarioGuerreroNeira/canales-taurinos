<div align="center">
  <table>
    <tr>
      <td align="center"><img src="./images/Canal Sur.png" width="80" alt="Canal Sur Logo"></td>
      <td align="center"><img src="./images/Castilla de la Mancha.jpg" width="80" alt="Castilla de la Mancha Media"></td>
      <td align="center"><img src="./images/Telemadrid.png" width="80" alt="Telemadrid Logo"></td>
      <td align="center"><img src="./images/OneToro.png" width="80" alt="OneToro Logo"></td>
      <td align="center"><img src="./images/El Muletazo.png" width="80" alt="El Muletazo Logo"></td>
      <td align="center"><img src="./images/Servi Toro.jpg" width="80" alt="Servitoro Logo"></td>
    </tr>
  </table>
</div>

<div align="center">
>
  <h1>Bot Taurino para Telegram con NestJS y Gemini</h1>
</div>

Este proyecto es un bot de Telegram inteligente, desarrollado con **NestJS**, que actúa como un asistente virtual para aficionados a la tauromaquia. El bot es capaz de comprender el lenguaje natural gracias a la **API de Gemini** y extrae información actualizada sobre los próximos festejos televisados mediante web scraping del portal **"El Muletazo"**.

---

## 📜 Descripción del Proyecto

El objetivo principal de este bot es ser el asistente de referencia para los aficionados taurinos, proporcionando una forma rápida y conversacional de consultar tanto la **agenda de festejos televisados** como el **calendario completo de la temporada taurina**. El bot combina la robustez de un backend en NestJS con la inteligencia artificial de Google Gemini para ofrecer una experiencia de usuario fluida e inteligente.

El bot es capaz de mantener conversaciones con contexto, recordar interacciones previas con el usuario, realizar búsquedas específicas más allá de la información general obtenida por web scraping y guiar al usuario a través de diálogos interactivos para filtrar información.

### ✨ Características Principales

- **Procesamiento de Lenguaje Natural (NLP)**: Utiliza el modelo `gemini-2.0-flash` para interpretar una amplia gama de solicitudes en lenguaje coloquial (ej: "quiero ver toros", "¿qué corridas televisan?"), responder preguntas generales sobre tauromaquia y realizar búsquedas específicas.
- **Web Scraping Dual**:
  - **Festejos Televisados**: Extrae la agenda de "El Muletazo" usando `axios` y `cheerio` para obtener información sobre las transmisiones.
  - **Calendario Taurino**: Realiza scraping de "Servitoro" usando `Puppeteer` para obtener el calendario completo de la temporada, manejando contenido cargado dinámicamente.
- **Sistema de Caché Avanzado**: Implementa un sistema de caché independiente para cada fuente de datos (El Muletazo y Servitoro), optimizando el rendimiento, reduciendo las peticiones a los sitios web y ofreciendo respuestas instantáneas.
- **Conversación Persistente con Gestión de Sesiones**: Utiliza `telegraf/session` para recordar el historial de chat de cada usuario, evitando saludos repetitivos y permitiendo conversaciones fluidas y con contexto.
- **Filtrado Interactivo con Telegraf Scenes**: Guía al usuario a través de diálogos de varios pasos para filtrar tanto las transmisiones (por mes, por canal) como el calendario taurino (por mes, ciudad, etc.).
- **Reconocimiento de Lenguaje Natural**: Entiende una gran variedad de frases coloquiales (ej: "agenda de festejos", "muéstrame el calendario", "¿quién hizo este bot?") para activar funcionalidades sin necesidad de usar comandos.
- **Flujo de Conversación Robusto**: Gestiona el estado de la conversación de forma inteligente, permitiendo al usuario salir de una función (como el calendario) y continuar con otra sin errores ni comportamientos inesperados.
- **Interfaz de Usuario Dinámica**: Personaliza los botones de los canales de transmisión con nombres descriptivos (ej: "Canal Sur", "T.Madrid") extraídos directamente de las URLs.
- **Guía Proactiva al Usuario**: El mensaje de bienvenida (`/start`) ahora presenta claramente los servicios disponibles y sugiere frases en lenguaje natural para interactuar, mejorando la experiencia inicial del usuario.
- **Comandos Directos**: Incluye comandos como `/transmisiones`, `/calendario` y `/contacto` para un acceso rápido, además de comandos de administración como `/clearcache`.

---

## 🏗️ Esquema de la Arquitectura

El siguiente diagrama ilustra el flujo de datos y la interacción entre los componentes del sistema. Ahora incluye las dos fuentes de scraping (`El Muletazo` y `Servitoro`) y las escenas correspondientes para cada funcionalidad.

```mermaid
graph TD
    subgraph "Usuario"
        U[📱 Usuario de Telegram]
    end

    subgraph "Backend (NestJS)"
        T[🤖 Telegraf Service]
        G[🧠 Gemini Service]
        SCENE1[🎭 Transmisiones Scene]
        SCENE2[🗓️ Calendario Scene]
        S1[🕸️ Scraper Service (El Muletazo)]
        S2[ puppeteer Servitoro Service]
        C[🗄️ Caché]
        SS[💾 Session Store]
    end

    subgraph "Servicios Externos"
        API_TG[🌐 API de Telegram]
        API_G[☁️ API de Google Gemini]
        WEB1[📰 Web de El Muletazo]
        WEB2[🎟️ Web de Servitoro]
    end

    U -- Mensaje de texto --> API_TG
    API_TG -- Webhook/Polling --> T

    T -- Inicia/Recupera Sesión --> SS
    SS -- Historial de Chat --> T

    T -- ¿Es un comando? --> T_CMD{Comando}
    T_CMD -- /transmisiones o /filtrar --> SCENE1
    T_CMD -- /calendario --> SCENE2
    T_CMD -- /clearcache... --> C
    T_CMD -- /start --> SS(Limpia Sesión)

    T -- ¿No es comando? --> G
    G -- Prompt enriquecido --> API_G
    API_G -- Respuesta NLP --> G
    G -- Decide Acción/Respuesta --> T

    subgraph "Lógica de Respuesta de Gemini"
        direction LR
        G_Decide{Decisión}
        G_Decide -- Pregunta Específica --> G_WebSearch[Búsqueda Web con Gemini]
        G_Decide -- "Agenda televisiva" --> G_Action1[Acción: GET_TRANSMISIONES]
        G_Decide -- "Calendario taurino" --> G_Action2[Acción: GET_CALENDARIO]
        G_Decide -- Saludo/Otro --> G_Text[Respuesta de Texto]
    end

    T -- Acción GET_TRANSMISIONES --> SCENE1
    T -- Acción GET_CALENDARIO --> SCENE2

    SCENE1 -- Pide datos --> S1
    SCENE2 -- Pide datos --> S2

    S1 -- ¿Hay caché válida? --> C
    S2 -- ¿Hay caché válida? --> C

    C -- Sí --> S1
    C -- Sí --> S2

    C -- No --> S1_Scrape[Scraping El Muletazo]
    C -- No --> S2_Scrape[Scraping Servitoro]

    S1_Scrape -- Petición HTTP --> WEB1
    WEB1 -- HTML --> S1_Scrape
    S1_Scrape -- Datos --> C & S1

    S2_Scrape -- Navegación Puppeteer --> WEB2
    WEB2 -- HTML Dinámico --> S2_Scrape
    S2_Scrape -- Datos --> C & S2

    S1 & S2 -- Eventos --> T
    T -- Formatea y Envía Respuesta --> API_TG
    API_TG -- Mensaje con botones --> U

    style U fill:#D6EAF8,stroke:#3498DB
    style T fill:#D5F5E3,stroke:#2ECC71
    style G fill:#FCF3CF,stroke:#F1C40F
    style SCENE1 fill:#FADBD8,stroke:#C0392B
    style SCENE2 fill:#FADBD8,stroke:#C0392B
    style S1 fill:#EBDEF0,stroke:#8E44AD
    style S2 fill:#EBDEF0,stroke:#8E44AD
    style C fill:#FDEDEC,stroke:#E74C3C
    style SS fill:#E8DAEF,stroke:#9B59B6
    style API_TG fill:#AEB6BF,stroke:#5D6D7E
    style API_G fill:#AEB6BF,stroke:#5D6D7E
    style WEB1, WEB2 fill:#AEB6BF,stroke:#5D6D7E
```

---

## 🛠️ Tecnologías Utilizadas

<div align="center">
  <a href="https://nestjs.com/" target="_blank"><img src="./images/nestjs.svg" width="70" alt="NestJS Logo"></a>
  <a href="https://www.typescriptlang.org/" target="_blank"><img src="./images/typescript.svg" width="70" alt="TypeScript Logo"></a>
  <a href="https://telegram.org/" target="_blank"><img src="./images/telegram.svg" width="70" alt="Telegram Logo"></a>
  <a href="https://ai.google.dev/" target="_blank"><img src="./images/gemini.svg" width="70" alt="Gemini Logo"></a>
  <a href="https://telegraf.js.org/" target="_blank"><img src="./images/telegraf.png" width="70" alt="Telegraf Logo"></a>
  <a href="https://pptr.dev/" target="_blank"><img src="https://user-images.githubusercontent.com/10379601/29446482-04f7036a-841f-11e7-9872-91d1fc2ea683.png" width="70" alt="Puppeteer Logo"></a>
  <a href="https://nodejs.org/" target="_blank"><img src="./images/nodejs.svg" width="70" alt="Node.js Logo"></a>
</div>

---

## 📊 Fuentes de Contenido

El bot se nutre de información proveniente de portales y canales de televisión especializados. Las fuentes principales para el scraping son **El Muletazo** y **Servitoro**. Las transmisiones anunciadas corresponden a diversos canales.

<div align="center">
  <a href="https://elmuletazo.com/agenda-de-toros-en-television/" target="_blank">
    <img src="https://i0.wp.com/elmuletazo.com/wp-content/uploads/2020/10/cropped-Logo-nuevo-El-Muletazo-con-fondo-y-sin-texto.png?fit=192%2C192&ssl=1" width="80" alt="El Muletazo Logo">
  </a>
  <a href="https://www.servitoro.com/" target="_blank">
    <img src="https://www.servitoro.com/img/logo-servitoro-1545136539.jpg" width="140" alt="Servitoro Logo">
  </a>
  <a href="https://www.canalsur.es/" target="_blank">
    <img src="https://www.canalsur.es/resources/img/canalsur/logo.svg" height="40" alt="Canal Sur Logo">
  </a>
  <a href="https://www.cmmedia.es/" target="_blank">
    <img src="https://www.cmmedia.es/images/logo-cmm.svg" height="40" alt="Castilla-La Mancha Media Logo">
  </a>
  <a href="https://www.telemadrid.es/" target="_blank">
    <img src="https://www.telemadrid.es/content/dam/telemadrid/logo-telemadrid-2017.svg" height="40" alt="Telemadrid Logo">
  </a>
  <a href="https://one-toro.com/" target="_blank">
    <img src="https://one-toro.com/wp-content/uploads/2023/03/logo-onetoro-blanco.svg" height="40" alt="OneToro Logo" style="background: #000; padding: 5px;">
  </a>
</div>

---

## � Instalación y Puesta en Marcha

Sigue estos pasos para ejecutar el proyecto en tu entorno local.

1.  **Clonar el repositorio:**

    ```bash
    git clone https://github.com/tu-usuario/bot-muletazo-nest.git
    cd bot-muletazo-nest
    ```

2.  **Instalar dependencias:**

    ```bash
    npm install
    ```

3.  **Configurar las variables de entorno:**
    Crea un archivo `.env` en la raíz del proyecto y añade las siguientes claves:

    ```env
    # Token de tu bot de Telegram, obtenido desde @BotFather
    BOT_TOKEN="TU_TOKEN_DE_TELEGRAM"

    # API Key de Google Gemini, obtenida desde Google AI Studio
    GOOGLE_API_KEY="TU_API_KEY_DE_GEMINI"

    # (Opcional, para desarrollo local con webhooks) URL pública generada por ngrok
    # NODE_ENV="development"
    # WEBHOOK_DOMAIN="https://xxxxxxxx.ngrok.io"
    ```

4.  **Construir el proyecto:**

    ```bash
    npm run build
    ```

5.  **Iniciar el bot:**
    ```bash
    npm run start:dev
    ```
    ¡Tu bot ya debería estar en línea y respondiendo en Telegram! Para desarrollo, el bot usará **long-polling**. Para producción, se configurará automáticamente para usar **webhooks**.

---

## 🚀 Despliegue (Render)

Este bot está optimizado para desplegarse en plataformas como Render.

1.  **Configuración en Render**:
    - Crea un nuevo "Web Service" y conéctalo a tu repositorio de GitHub.
    - **Build Command**: `npm install && npm run build`
    - **Start Command**: `npm run start:prod`

2.  **Variables de Entorno**:
    - Añade las variables `BOT_TOKEN` y `GOOGLE_API_KEY` en la sección de "Environment" de tu servicio en Render.
    - Render provee automáticamente la variable `RENDER_EXTERNAL_URL`, que el bot usará para configurar el webhook. No necesitas añadirla manualmente.

Al desplegar, el bot detectará el entorno de producción, configurará el webhook automáticamente y estará listo para recibir mensajes.

## ✍️ Autor

**Rubén D. Guerrero N.** - _"Me encantaría leer o escuchar tus sugerencias para seguir mejorando este bot."_

- Desarrollador Backend
- GitHub: @rudar-21
- LinkedIn: ruben-d-guerrero-n
- Telegram: @Rubedev
- WhatsApp: +57 3207710450 / +58 4160897020
- Email: rudargeneira@gmail.com

---

## 📄 Licencia

Este proyecto está bajo la Licencia MIT. Consulta el archivo `LICENSE` para más detalles.
