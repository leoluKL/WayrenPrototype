# WayrenPrototype — Project Context

## Overview
An Android app that wraps a React frontend in a WebView and uses a native Kotlin bridge to communicate with the **Wayren Companion** gRPC service on the same device (`127.0.0.1:7073`). This enables Command & Control (C2) features (chat + GIS) over the Singularity mesh network.

## Architecture

```
React Frontend (WebView)
  → nativeBridge.ts (TypeScript bridge)
    → WebAppInterface.kt (@JavascriptInterface)
      → GrpcClient.kt (gRPC stub)
        → Wayren Companion (localhost:7073, plaintext)
          → Singularity Network
```

## Key Design Decisions

- **gRPC on localhost**: Wayren Companion binds to `127.0.0.1:7073` on the same phone. Insecure/plaintext is fine — no network exposure.
- **Dual bridge pattern**: `callNativeApi()` for request/response, `subscribeToNativeStream()` for streaming.
- **Auto-reconnect**: `GrpcClient.waitForService()` keeps pinging every 3s until the companion is reachable.
- **All logs use tag**: `WayrenApp`

## Frontend Build Pipeline

1. Develop in `frontend/` using `npm run dev` (Vite dev server, desktop browser)
2. Run `npm run deploy` — builds with Vite and copies `dist/` → `app/src/main/assets/www/`
3. Vite `base: '/assets/www/'` matches Android `WebViewAssetLoader` serving path

## gRPC Service: `GrpcMessageService.proto`

**Package**: `ee.wayren.icp.services.grpc.MessageService`
**Transport**: OkHttp, plaintext, no TLS/auth

### Active RPCs (currently implemented):
| RPC | Type | Purpose |
|---|---|---|
| `Ping` | Unary | Health check |

### Next RPCs to implement:
| RPC | Type | Purpose |
|---|---|---|
| `CreateMessage` | Unary | Send chat/GIS data |
| `StreamAllNewMessages` | Server streaming | Receive chat/GIS data from network |

### Available RPCs (not yet implemented):
- `FetchTimestamp`, `FetchRouterUuid`, `FetchStorageUuid` (unary)
- `SaveExternallyCreatedMessage` (unary)
- `StreamMessagesByChannelInReceiveOrder` (bidi streaming)
- `FetchMessagesByChannel` (server streaming)
- `CreateChannel` (unary)
- `StreamAllChannels` (server streaming)

## Application-Layer Encoding

**Send path**: Create `WayrenChat.Envelope` → `TextMessage` → protobuf encode → set as `NewMessage.data` bytes
**Receive path**: `Message.data` bytes → `Envelope.decode()` → parse `text_message`, `ack_message`, or `enc_message`

Channel IDs (from Node.js demos):
- `ALLCONCHANNEL = 16140341465198178175`
- `VIPCHANNEL = 7134513312021609663`

## Planned Features (C2 Prototype)

1. **Chat window** — Send/receive text messages between devices via Singularity
2. **GIS window** — Draw polygons, lines, add/move object icons, sync operations between devices
3. Both use the same `CreateMessage` / `StreamAllNewMessages` RPCs with different payload encoding

## Proto Files (in `app/src/main/proto/`)

- `Common.proto` — Uuid, Timestamp
- `Channels.proto` — Channel
- `Messages.proto` — Message, MessageHeader, MessageMetadata
- `Services.proto` — NewMessage, subscription queries, enums
- `GrpcMessageService.proto` — Service definition (11 RPCs)

## Source Files

- `app/.../MainActivity.kt` — Single activity, sets up WebView + WebViewAssetLoader + bridge
- `app/.../WebAppInterface.kt` — @JavascriptInterface bridge (sendToNative, startNativeStream, stopNativeStream)
- `app/.../GrpcClient.kt` — gRPC channel + stub manager with auto-reconnect
- `frontend/src/nativeBridge.ts` — TypeScript bridge (callNativeApi, subscribeToNativeStream)
- `frontend/src/App.jsx` — Main React component (scaffold, to be replaced)
- `frontend/copy-build.js` — Deploy script: builds frontend, copies to Android assets

## Debugging

- **Logcat**: `adb logcat -s WayrenApp`
- **Chrome DevTools**: `chrome://inspect` (WebView remote debugging enabled)

## IDE Note: Proto generated stubs not resolved

With AGP 9.x + protobuf plugin, generated Java files end up in `app/build/generated/java/generateDebugProto/`. The IDE doesn't auto-detect them. Fix:

1. **File → Project Structure → Modules → app → Sources tab**
2. Click `+` → "Add Content Root" → navigate to `app/build/generated/java/generateDebugProto/`
3. In the tree, separately mark **both** the `java/` and `grpc/` subdirectories as blue "Sources" root
4. Do NOT mark the parent `generateDebugProto` as source — only the two subdirectories
