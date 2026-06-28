# Wise Banco Material — Microservicio Backend

Repositorio digital colaborativo donde los usuarios pueden almacenar, buscar y calificar materiales de apoyo académico (PDF) organizados por asignaturas, semestres y temas. El servicio orquesta la validación automática mediante IA, el almacenamiento en la nube y las notificaciones por correo.

---

## Tabla de contenidos

1. [Tecnologías](#tecnologías)
2. [Arquitectura Hexagonal](#arquitectura-hexagonal)
3. [Flujo de subida de material](#flujo-de-subida-de-material)
4. [Modelo de datos](#modelo-de-datos)
5. [Estructura del proyecto](#estructura-del-proyecto)
6. [Variables de entorno](#variables-de-entorno)
7. [Proveedores intercambiables](#proveedores-intercambiables)
8. [Instalación y ejecución](#instalación-y-ejecución)
9. [Documentación API (Swagger)](#documentación-api-swagger)
10. [Endpoints disponibles](#endpoints-disponibles)
11. [Testing](#testing)
12. [CI/CD](#cicd)
13. [Docker](#docker)
14. [Convenciones de commits](#convenciones-de-commits)

---

## Tecnologías

![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white)
![NestJS](https://img.shields.io/badge/NestJS-E0234E?style=for-the-badge&logo=nestjs&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-43853D?style=for-the-badge&logo=node.js&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-316192?style=for-the-badge&logo=postgresql&logoColor=white)
![Prisma](https://img.shields.io/badge/Prisma-3982CE?style=for-the-badge&logo=Prisma&logoColor=white)
![Swagger](https://img.shields.io/badge/Swagger-85EA2D?style=for-the-badge&logo=swagger&logoColor=black)
![Jest](https://img.shields.io/badge/Jest-C21325?style=for-the-badge&logo=jest&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-2496ED?style=for-the-badge&logo=docker&logoColor=white)
![Azure](https://img.shields.io/badge/Microsoft_Azure-0089D0?style=for-the-badge&logo=microsoft-azure&logoColor=white)
![AWS](https://img.shields.io/badge/AWS-232F3E?style=for-the-badge&logo=amazon-aws&logoColor=white)
![RabbitMQ](https://img.shields.io/badge/RabbitMQ-FF6600?style=for-the-badge&logo=rabbitmq&logoColor=white)
![SonarQube](https://img.shields.io/badge/SonarQube-4E9BCD?style=for-the-badge&logo=sonarqube&logoColor=white)

| Capa | Tecnología |
|---|---|
| Framework | NestJS 11 (Node.js 20+) |
| Lenguaje | TypeScript |
| ORM | Prisma + PostgreSQL |
| Almacenamiento | Azure Blob Storage **o** AWS S3 |
| Mensajería | Azure Service Bus **o** RabbitMQ |
| Documentación | Swagger / OpenAPI 3 |
| Testing | Jest (unit + coverage) |
| Calidad | ESLint, Husky pre-push, SonarQube Cloud |
| CI/CD | GitHub Actions |
| Contenedor | Docker multi-stage → GHCR |

---

## Arquitectura Hexagonal

El servicio implementa el patrón **Ports & Adapters** (Hexagonal Architecture). La lógica de negocio en `MaterialService` nunca depende de SDKs concretos: sólo conoce las interfaces `StoragePort` y `MessageBusPort`. Los adaptadores concretos (Azure, AWS, RabbitMQ) se inyectan en tiempo de arranque según variables de entorno.

```mermaid
graph TB
    subgraph Dominio["Dominio (núcleo)"]
        MS["MaterialService"]
    end

    subgraph Puertos["Puertos (interfaces)"]
        SP["StoragePort\n«interface»"]
        MBP["MessageBusPort\n«interface»"]
    end

    subgraph AdaptadoresStorage["Adaptadores · Almacenamiento"]
        AB["AzureBlobAdapter"]
        S3["S3Adapter"]
    end

    subgraph AdaptadoresBus["Adaptadores · Mensajería"]
        ASB["AzureServiceBusAdapter"]
        RMQ["RabbitMQAdapter"]
    end

    subgraph Infra["Infraestructura"]
        CM["CommonModule\n(factory por env var)"]
        DB["PostgreSQL\nvía Prisma"]
    end

    MS -->|usa| SP
    MS -->|usa| MBP
    SP -.->|implementado por| AB
    SP -.->|implementado por| S3
    MBP -.->|implementado por| ASB
    MBP -.->|implementado por| RMQ
    CM -->|provee| SP
    CM -->|provee| MBP
    MS -->|persiste| DB

    style Dominio fill:#1e3a5f,color:#fff,stroke:#4a90d9
    style Puertos fill:#2d5016,color:#fff,stroke:#7bc142
    style AdaptadoresStorage fill:#5c3317,color:#fff,stroke:#e07b39
    style AdaptadoresBus fill:#4a1942,color:#fff,stroke:#c46eb1
    style Infra fill:#1a1a2e,color:#fff,stroke:#7a7aaa
```

### Por qué hexagonal

- **Intercambiabilidad**: cambiar de Azure a AWS requiere sólo modificar `STORAGE_PROVIDER` en el `.env`. Sin tocar el dominio.
- **Testabilidad**: los tests mockean las interfaces, no los SDKs externos. 144 tests unitarios sin dependencias de red.
- **Aislamiento**: un fallo en el adaptador de mensajería no rompe la lógica de almacenamiento.

---

## Flujo de subida de material

Cuando un usuario sube un PDF el servicio ejecuta la siguiente secuencia:

```mermaid
sequenceDiagram
    actor U as Usuario
    participant C as MaterialController
    participant S as MaterialService
    participant ST as StoragePort
    participant MB as MessageBusPort
    participant IA as Servicio IA (externo)
    participant DB as PostgreSQL

    U->>C: POST /material (PDF + metadata)
    C->>C: Valida mimetype PDF
    C->>S: validateMaterial(buffer, dto, filename)

    S->>S: Calcula SHA-256 del buffer
    S->>DB: ¿Existe hash duplicado?
    DB-->>S: No existe

    S->>ST: upload(buffer, name, contentType)
    ST-->>S: fileUrl

    S->>MB: send("material.process", {fileUrl, filename}, {correlationId})
    MB-->>IA: mensaje encolado

    IA-->>MB: respuesta en "material.responses"
    MB-->>S: onMessage(body, correlationId)

    alt PDF válido
        S->>DB: Guardar Materiales + Tags
        S->>MB: send("mail.envio.individual", {email, template})
        S-->>C: CreateMaterialResponseDto
        C-->>U: 201 Created
    else PDF inválido
        S->>ST: delete(fileUrl)
        S-->>C: UnprocessableEntityException
        C-->>U: 422 Unprocessable Entity
    end
```

---

## Modelo de datos

```mermaid
erDiagram
    usuarios {
        string id PK
        string email
        string nombre
        string apellido
        string telefono
        string biografia
        int semestre
        string google_id
        string avatar_url
        int rol_id
        int estado_id
        datetime ultimo_login
        datetime created_at
        datetime updated_at
    }

    Materiales {
        string id PK
        string nombre
        string userId FK
        string url
        string extension
        string descripcion
        int vistos
        int descargas
        string hash
        datetime createdAt
        datetime updatedAt
    }

    Tags {
        int id PK
        string tag
    }

    MaterialTags {
        int idTag FK
        string idMaterial FK
    }

    Calificaciones {
        int id PK
        string idMaterial FK
        string userId FK
        int calificacion
        string comentario
        datetime createdAt
    }

    Resumen {
        int id PK
        string idMaterial FK
        string resumen
    }

    usuarios ||--o{ Materiales : "sube"
    usuarios ||--o{ Calificaciones : "califica"
    Materiales ||--o{ MaterialTags : "tiene"
    Tags ||--o{ MaterialTags : "agrupa"
    Materiales ||--o{ Calificaciones : "recibe"
    Materiales ||--o{ Resumen : "genera"
```

---

## Estructura del proyecto

```
wise_banco_material/
├── .github/
│   └── workflows/
│       ├── build.yml          # SonarQube + cobertura (push a develop / PR)
│       └── publish.yml        # Build y push a GHCR (push a main o develop)
├── .husky/
│   └── pre-push               # Bloquea push si hay errores de lint
├── prisma/
│   └── schema.prisma          # Modelos: Materiales, usuarios, Tags, Calificaciones
├── src/
│   ├── common/
│   │   ├── ports/
│   │   │   ├── storage.port.ts        # StoragePort (interface + token)
│   │   │   └── message-bus.port.ts    # MessageBusPort (interface + token)
│   │   ├── adapters/
│   │   │   ├── storage/
│   │   │   │   ├── azure-blob.adapter.ts   # Adaptador Azure Blob Storage
│   │   │   │   └── s3.adapter.ts           # Adaptador AWS S3
│   │   │   └── message-bus/
│   │   │       ├── azure-service-bus.adapter.ts  # Adaptador Azure Service Bus
│   │   │       └── rabbitmq.adapter.ts           # Adaptador RabbitMQ
│   │   ├── base-bus.service.ts        # Clase base abstracta para buses
│   │   └── common.module.ts           # Wiring de adaptadores por env var
│   ├── config/
│   │   └── env.ts             # Validación de variables de entorno con Joi
│   ├── material/
│   │   ├── dto/               # DTOs de entrada/salida + decoradores Swagger
│   │   ├── entities/          # Entidades de dominio
│   │   ├── material.controller.ts   # 22 endpoints REST
│   │   ├── material.service.ts      # Lógica de negocio (usa ports)
│   │   ├── material.module.ts       # Importa CommonModule + PrismaModule
│   │   ├── material.controller.spec.ts
│   │   └── material.service.spec.ts
│   ├── pdf-export/
│   │   ├── pdf-export.controller.ts  # Exportación de estadísticas a PDF
│   │   └── pdf-export.service.ts
│   ├── prisma/
│   │   ├── prisma.service.ts   # PrismaClient singleton
│   │   └── prisma.module.ts
│   ├── app.module.ts
│   └── main.ts                # Bootstrap + Swagger condicional
├── .env.template              # Plantilla de variables de entorno
├── eslint.config.mjs          # ESLint + Prettier + TypeScript rules
├── sonar-project.properties   # Config SonarQube Cloud
├── Dockerfile                 # Build multi-stage
└── package.json
```

---

## Variables de entorno

Copia `.env.template` a `.env` y completa los valores según el proveedor elegido.

```env
# ── Aplicación ─────────────────────────────────────────────────────────
NODE_ENV=development
PORT=3000
SWAGGER_ENABLED=true

# ── Proveedor de almacenamiento ─────────────────────────────────────────
# Valores válidos: azure | s3
STORAGE_PROVIDER=azure

# ── Proveedor de mensajería ─────────────────────────────────────────────
# Valores válidos: azure | rabbitmq
MESSAGE_BUS_PROVIDER=azure

# ── Azure Blob Storage (requerido si STORAGE_PROVIDER=azure) ───────────
BLOB_STORAGE_CONNECTION_STRING=DefaultEndpointsProtocol=https;AccountName=...
BLOB_STORAGE_ACCOUNT_NAME=your-account-name

# ── AWS S3 (requerido si STORAGE_PROVIDER=s3) ──────────────────────────
AWS_ACCESS_KEY_ID=your-access-key-id
AWS_SECRET_ACCESS_KEY=your-secret-access-key
AWS_REGION=us-east-1
S3_BUCKET_NAME=your-bucket-name

# ── Azure Service Bus (requerido si MESSAGE_BUS_PROVIDER=azure) ─────────
SERVICE_BUS_CONNECTION_STRING=Endpoint=sb://your-namespace...

# ── RabbitMQ (requerido si MESSAGE_BUS_PROVIDER=rabbitmq) ───────────────
RABBITMQ_URL=amqp://user:password@localhost:5672

# ── Base de datos ───────────────────────────────────────────────────────
DATABASE_URL="postgresql://user:pass@host:5432/db?schema=public"
DIRECT_URL="postgresql://user:pass@host:5432/db?schema=public"
```

> La validación de variables se realiza al arranque con **Joi** (`src/config/env.ts`). Las variables de un proveedor no seleccionado son opcionales; las del proveedor activo son obligatorias.

---

## Proveedores intercambiables

```mermaid
graph LR
    subgraph ENV["Variable de entorno"]
        SP["STORAGE_PROVIDER"]
        MP["MESSAGE_BUS_PROVIDER"]
    end

    subgraph Storage["Almacenamiento"]
        SP -->|azure| AZ["Azure Blob Storage\n@azure/storage-blob"]
        SP -->|s3| S3["AWS S3\n@aws-sdk/client-s3"]
    end

    subgraph Bus["Mensajería"]
        MP -->|azure| SB["Azure Service Bus\n@azure/service-bus"]
        MP -->|rabbitmq| RMQ["RabbitMQ\namqplib"]
    end

    style ENV fill:#2c3e50,color:#fff,stroke:#7f8c8d
    style Storage fill:#1a3a4a,color:#fff,stroke:#3498db
    style Bus fill:#3a1a1a,color:#fff,stroke:#e74c3c
```

Para cambiar de proveedor en producción basta con actualizar la variable de entorno y reiniciar el contenedor. No se requiere recompilación ni cambios en el código.

---

## Instalación y ejecución

### 1. Clonar y dependencias

```bash
git clone <repository-url>
cd wise_banco_material
npm install
```

### 2. Variables de entorno

```bash
cp .env.template .env
# Editar .env con los valores correspondientes
```

### 3. Generar cliente Prisma

```bash
npx prisma generate
```

### 4. Desarrollo

```bash
# Hot reload
npm run start:dev

# Debug
npm run start:debug
```

### 5. Producción

```bash
npm run build
npm run start:prod
```

---

## Documentación API (Swagger)

Disponible en `http://localhost:3000/api` cuando `SWAGGER_ENABLED=true`.

La documentación incluye:

- Descripción completa de cada endpoint
- Esquemas de request/response con ejemplos
- Códigos de error documentados (400, 404, 409, 422)
- Agrupación por tags: **Material**, **PDF Export**

Para deshabilitar en producción:

```env
SWAGGER_ENABLED=false
```

---

## Endpoints disponibles

### Materiales (`/material`)

| Método | Ruta | Descripción |
|--------|------|-------------|
| `POST` | `/material` | Subir nuevo PDF — valida con IA, detecta duplicados |
| `GET` | `/material` | Listar todos los materiales (paginado) |
| `GET` | `/material/search` | Búsqueda por nombre |
| `GET` | `/material/filter` | Búsqueda avanzada con filtros múltiples |
| `GET` | `/material/sorted/by-date` | Listar ordenado por fecha |
| `GET` | `/material/stats/popular` | Top materiales más populares |
| `GET` | `/material/stats/count` | Conteo total |
| `GET` | `/material/stats/tags-percentage` | Distribución global de tags |
| `GET` | `/material/:id` | Detalle de un material |
| `GET` | `/material/:id/download` | Descargar PDF (stream) |
| `PUT` | `/material/:id` | Actualizar versión (metadata o archivo) |
| `DELETE` | `/material/:id` | Eliminar material y blob |
| `POST` | `/material/:id/ratings` | Calificar un material (1–5 estrellas) |
| `GET` | `/material/:id/ratings` | Promedio y total de calificaciones |
| `GET` | `/material/:id/ratings/list` | Lista de calificaciones con comentarios |
| `GET` | `/material/user/:userId` | Materiales de un usuario con stats |
| `GET` | `/material/user/:userId/stats` | Estadísticas agregadas del usuario |
| `GET` | `/material/user/:userId/top-downloaded` | Top 3 más descargados |
| `GET` | `/material/user/:userId/top-viewed` | Top 3 más vistos |
| `GET` | `/material/user/:userId/top` | Todos ordenados por popularidad |
| `GET` | `/material/user/:userId/average-rating` | Calificación promedio del usuario |
| `GET` | `/material/user/:userId/tags-percentage` | Distribución de tags del usuario |

### PDF Export (`/pdf-export`)

| Método | Ruta | Descripción |
|--------|------|-------------|
| `GET` | `/pdf-export/:id/stats/export` | Exportar estadísticas de un material a PDF |

---

## Testing

```bash
# Tests unitarios
npm run test

# Watch mode
npm run test:watch

# Con reporte de cobertura (genera coverage/lcov.info para SonarQube)
npm run test:cov
```

**Cobertura actual**: 144 tests unitarios sobre `MaterialService` y `MaterialController`.

Los tests de servicio mockean `StoragePort` y `MessageBusPort` directamente — sin dependencias de SDKs externos, sin red.

```bash
# Lint (0 warnings, 0 errors)
npm run lint:check

# Autofix
npm run lint
```

El hook `pre-push` de Husky ejecuta `lint:check` automáticamente y bloquea el push si hay errores.

---

## CI/CD

```mermaid
flowchart TD
    A[Push / PR] --> B{Rama}
    B -->|develop o PR| C[build.yml]
    B -->|main o develop| D[publish.yml]

    subgraph Build["build.yml — SonarQube"]
        C --> C1[Checkout]
        C1 --> C2[Setup Node 20]
        C2 --> C3[npm ci]
        C3 --> C4[npm run test:cov]
        C4 --> C5[SonarQube Scan\ncon coverage/lcov.info]
    end

    subgraph Publish["publish.yml — Docker"]
        D --> D1[Checkout]
        D1 --> D2[Lowercase image name]
        D2 --> D3[Docker meta\nsha + branch tags]
        D3 --> D4[Login GHCR]
        D4 --> D5[Build & Push\nghcr.io/dosw2025/wise_banco_material]
    end

    style Build fill:#0d1117,color:#58a6ff,stroke:#30363d
    style Publish fill:#0d1117,color:#3fb950,stroke:#30363d
```

### Secretos requeridos en GitHub

| Secreto | Usado en |
|---|---|
| `SONAR_TOKEN` | `build.yml` — análisis SonarQube Cloud |
| `DATABASE_URL` | `build.yml` — Prisma generate en CI |
| `DIRECT_URL` | `build.yml` — Prisma directURL |
| `GITHUB_TOKEN` | `publish.yml` — push a GHCR (automático) |

---

## Docker

```bash
# Construir imagen local
docker build -t wise_banco_material .

# Ejecutar con variables de entorno
docker run -p 3000:3000 \
  -e NODE_ENV=production \
  -e PORT=3000 \
  -e STORAGE_PROVIDER=azure \
  -e MESSAGE_BUS_PROVIDER=azure \
  -e BLOB_STORAGE_CONNECTION_STRING="..." \
  -e BLOB_STORAGE_ACCOUNT_NAME="..." \
  -e SERVICE_BUS_CONNECTION_STRING="..." \
  -e DATABASE_URL="..." \
  wise_banco_material
```

La imagen se publica automáticamente en `ghcr.io/dosw2025/wise_banco_material` con tags de rama y SHA en cada push a `main` o `develop`.

---

## Convenciones de commits

Seguimos [Conventional Commits](https://www.conventionalcommits.org/):

```
<tipo>(<alcance>): <descripción corta>
```

| Tipo | Uso |
|---|---|
| `feat` | Nueva funcionalidad |
| `fix` | Corrección de bug |
| `docs` | Documentación |
| `refactor` | Refactorización sin cambio de comportamiento |
| `test` | Tests nuevos o modificados |
| `chore` | Mantenimiento (deps, config, CI) |
| `style` | Formato, lint |

---

## Licencia

Proyecto privado — DOSW2025 / EciWise.
