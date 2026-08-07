# AGENTS.md — Instrucciones para Mistral Vibe en stxt-cli

## Contexto del Repositorio

Este repositorio (`/home/joan/eclipse-workspace/stxt-cli/`) contiene la **interfaz de línea de comandos oficial para STXT** (`@stxt-lang/cli`), el lenguaje textual jerárquico "Human-First".

### Posición en el ecosistema STXT

```
stxt-web (spec) → stxt-impl (pseudocódigo) → stxt-js (@stxt-lang/core) → stxt-cli (este repo)
```

- **stxt-web**: Contiene las especificaciones canónicas (core, schema, template, discovery)
- **stxt-js**: Implementación de referencia en TypeScript (`@stxt-lang/core`)
- **stxt-cli**: **Este repositorio** — CLI que consume `@stxt-lang/core`

El CLI **no implementa** parsing ni validación: delega en `@stxt-lang/core`. Su función es exponer 
una interfaz de línea de comandos para parsear, validar y formatear documentos STXT.

---

## Resumen de la Sesión de Trabajo (2026-08-07)

### Decisiones tomadas y cambios realizados:

1. **Reorganización del ROADMAP.md**:
   - Se renumeraron las versiones para priorizar el entorno:
     - 0.1.0: Skeleton (implementado)
     - 0.2.0: Schema paths and installation (antes 0.5.0)
     - 0.3.0: Checking documents (antes 0.2.0)
     - 0.4.0: Formatting (antes 0.3.0)
     - 0.5.0: Conversion (antes 0.4.0)

2. **Movimiento de `stxt compile <template>`**:
   - Pasó de **0.2.0 (Schema paths and installation)** a **0.5.0 (Conversion)**

3. **Clarificación de la sintaxis de paths**:
   - Cambiado `<path>...` por `<file|dir>...` en comandos `check` y `format`
   - Añadido `[path]` opcional a `stxt schemas`

4. **Documentación actualizada**:
   - Creado/actualizado `cli.txt` con todas las opciones documentadas
   - Formato: comando + explicación detallada de cada opción

5. **Ficheros afectados**:
   - `ROADMAP.md`: Reordenado y actualizado
   - `cli.txt`: Creado con documentación completa de comandos

---

## Estructura del Proyecto

```
stxt-cli/
├── src/
│   ├── cli.ts              # Entry point (delega a Cli.run)
│   ├── runtime/
│   │   ├── Cli.ts          # Lógica principal: routing de comandos
│   │   ├── ExitCode.ts     # Códigos de salida: OK(0), DOCS_FAILED(1), USAGE(2)
│   │   └── PackageInfo.ts  # Lee versiones de package.json
│   └── discovery/
│       └── NodeDiscovery.ts # Adaptadores Node.js para DiscoveryResolver
│
├── out/                   # Compilado (TypeScript → JS)
├── cli.txt                # Resumen de comandos y opciones
├── ROADMAP.md             # Hoja de ruta con versiones y decisiones
├── package.json           # Dependencia clave: @stxt-lang/core ^0.6.0
└── tsconfig.json          # TypeScript: CommonJS, ES2022, strict
```

---

## Estado Actual (v0.1.0)

### ✅ Implementado
- Esqueleto TypeScript/Node.js (mismo setup que stxt-js)
- Executable `stxt` (bin: out/cli.js)
- Comandos básicos: `--version`, `--help`
- Sistema de discovery: `NodeDiscoveryFileSystem` + `NodeDiscoveryEnvironment`
- Tests: CLI básico y adaptadores de discovery

### 📋 Próximos (según ROADMAP.md)

| Versión | prioridad | Comando | Estado |
|---------|-----------|---------|--------|
| 0.2.0 | Alta | `stxt install`, `stxt schemas [path]`, `stxt compile` | Planificado |
| 0.3.0 | Alta | `stxt check <file|dir>...` | Next |
| 0.4.0 | Media | `stxt format <file|dir>...` | Planificado |
| 0.5.0 | Media | `stxt parse`, `stxt from-json`, `stxt compile` | Planificado |

---

## Convenciones y Reglas Críticas

### Formato de archivos
- **TypeScript**: CommonJS modules, ES2022, strict mode
- **Indentación**: Espacios (2 espacios en el código fuente)
- **Nombres**: camelCase para variables/funciones, PascalCase para clases

### Sistema de discovery (STXT-DISCOVERY-SPEC)
- **No reinventar**: Usar siempre `createDiscoveryResolver()` de `src/discovery/NodeDiscovery.ts`
- **Un resolver por invocación**: Como indica la spec (sección 7), pero con caché compartido
- **Precedencia**: Por namespace, no por directorio en bloque
- **STXT_PATH**: Si está definida, reemplaza toda la cadena de resolución

### Códigos de salida
| Código | Significado |
|--------|-------------|
| 0 | OK: comando ejecutado correctamente |
| 1 | DOCS_FAILED: documentos con errores (parse/schema) |
| 2 | USAGE: error en la línea de comandos |

### Opciones de CLI
- **Solo forma larga**: `--version`, no `-v` ni `-V`
- **GNU style**: `--opcion valor` o `--opcion=valor`
- **Orden recomendado**: `stxt <comando> <file|dir>... --opciones`
- **Ayuda contextual**: `--help` funciona en cualquier punto de la línea

---

## Instrucciones para Mistral Vibe

### Al trabajar en este repositorio

1. **Siempre consulta primero**:
   - `stxt-web/es/stxt-discovery-ref.stxt` (para discovery)
   - `stxt-web/es/stxt-core-ref.stxt` (para sintaxis base)
   - `stxt-js/src/` (para la implementación de referencia)

2. **Nunca implementes parsing/validación aquí**:
   - Usa `@stxt-lang/core` (ya es dependencia)
   - El CLI es una **capa fina** sobre el core

3. **Para nuevos comandos**:
   - Añade el caso al router en `src/runtime/Cli.ts`
   - Crea el módulo del comando en `src/commands/` (aún no existe, pero es la convención implícita)
   - Usa `createDiscoveryResolver()` para resolución de schemas
   - Añade tests en `src/test/`

4. **Antes de commitar**:
   ```bash
   npm run lint    # eslint src --ext .ts
   npm run build   # tsc
   npm test        # mocha out/test/**/*.test.js
   ```

5. **Publicación**:
   - `prepublishOnly: npm test` → no se publica si no pasan los tests
   - Versión propia (no ligada a @stxt-lang/core)

---

## Comandos Actuales y su Propósito

### Implementados (v0.1.0)
```
stxt --version    # Versión CLI + parser
stxt --help       # Ayuda
```

### Planificados (ver ROADMAP.md para detalles)

| Comando | Versión | Propósito |
|---------|---------|-----------|
| `stxt install <file>` | 0.2.0 | Copiar schema/template a nivel local/user/system |
| `stxt schemas [path]` | 0.2.0 | Listar namespaces resolubles para un path |
| `stxt compile <template>` | 0.5.0 | Template → Schema |
| `stxt check <file|dir>...` | 0.3.0 | Validar documentos (parse + schema) |
| `stxt format <file|dir>...` | 0.4.0 | Aplicar formato canónico |
| `stxt parse <file>` | 0.5.0 | STXT → JSON canónico |
| `stxt from-json <file>` | 0.5.0 | JSON → STXT |

---

## Referencias Rápidas

| Recurso | Ubicación | Descripción |
|---------|----------|-------------|
| STXT-DISCOVERY-SPEC | `../stxt-web/es/stxt-discovery-ref.stxt` | Especificación de resolución |
| STXT-SPEC | `../stxt-web/es/stxt-core-ref.stxt` | Sintaxis base |
| Core JS | `../stxt-js/src/` | Implementación de referencia |
| Discovery JS | `../stxt-js/src/discovery/` | DiscoveryResolver |
| NodeDiscovery | `src/discovery/NodeDiscovery.ts` | Adaptadores Node.js |

---

## Notas Adicionales

- **Node**: Requiere Node 20 o superior (engines.node en package.json)
- **IDE**: Eclipse (archivos `.project` y `.settings/` existen)
- **Publicación**: npm como `@stxt-lang/cli` (scope público)
- **No hacer commit/push**: El usuario (Joan Costa Mombiela) lo hace manualmente
- **Idioma**: Responder en español (a menos que se solicite lo contrario)

---

*Última actualización: 2026-08-07*
