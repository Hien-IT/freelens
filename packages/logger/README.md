# @freelensapp/logger

This package contains stuff related to creating Lens-applications.

## Usage

```sh
npm install @freelensapp/logger
```

The package has an entry point per process. Each process registers its own
feature, which brings in the common one:

```typescript
// main: writes with winston
import { loggerFeatureForMain, loggerTransportInjectionToken, winstonLoggerInjectable } from "@freelensapp/logger/main";

// renderer: writes without Node, shaping the entries as the winston logger of main does
import { LoggerTransport, loggerFeatureForRenderer, loggerTransportInjectionToken } from "@freelensapp/logger/renderer";

// both: the tokens to log with
import { loggerInjectionToken, prefixedLoggerInjectable } from "@freelensapp/logger";
import type { Logger } from "@freelensapp/logger";
```

Renderer code imports only `@freelensapp/logger` and
`@freelensapp/logger/renderer`, so that winston stays out of the renderer.

## Extendability
