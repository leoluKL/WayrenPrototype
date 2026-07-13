// Expose a global receiver function that your Kotlin code (in WebAppInterface.kt) can call to
// send the one time process result

const pendingCallbacks = new Map<string, (value: any) => void>(); // Map to track pending requests and their respective Promise resolve handlers
(window as any).handleAndroidResponse = (callbackId: string, jsonResponseString: string) => {
  const actionResolveFunc = pendingCallbacks.get(callbackId);
  if (actionResolveFunc) {
    const data = JSON.parse(jsonResponseString);
    actionResolveFunc(data);
    pendingCallbacks.delete(callbackId);
  }
};

// Expose a global stream dispatcher function that your Kotlin code (in WebAppInterface.kt) can call to
// send the Real-Time Streaming Data
const streamListeners = new Map<string, (data: any) => void>();
(window as any).handleAndroidStreamEvent = (streamId: string, jsonResponseString: string) => {
  const listener = streamListeners.get(streamId);
  if (listener) {
    const data = JSON.parse(jsonResponseString);
    listener(data);
  }
};

/**
 * callNativeApi is for frontend ui need to call native android function API
 * @param action The endpoint or method name (e.g., 'ping')
 * @param payload The data argument to pass to Kotlin
 */
export async function callNativeApi<T = any>(action: string, payload: any = {}): Promise<T> {
  return new Promise((resolve) => {

    // Desktop Browser Safeguard: Avoid crashes when testing on your computer
    if (!(window as any).AndroidBridge) {
      console.warn(`AndroidBridge not found. Respond mocking data for action: ${action}`);
      if (action === 'ping') return resolve("pong");
      return resolve({ status: "mock_success" } as any);
    }

    // Generate a unique tracking ID for this asynchronous call
    const callbackId = `${action}_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

    // Register the callback handler
    pendingCallbacks.set(callbackId, resolve);

    // Flatten payload to string and pass it across the native boundary to WebAppInterface
    const jsonString = JSON.stringify(payload??{});
    (window as any).AndroidBridge.sendToNative(action, jsonString, callbackId);
  });
}

/**
 * subscribeToNativeInternalStream is for frontend ui subscribes to a real-time stream from Kotlin
 * @param action The streaming action name (e.g., 'subscribePriceStream')
 * @param payload Initialization parameters for the stream
 * @param onData Callback function executed every time new stream data arrives
 * @return A function to unsubscribe and close the stream
 */
export function subscribeToNativeInternalStream<T = any>(
  action: string,
  payload: any,
  onData: (data: T) => void
): () => void {

  // Generate a unique stream ID to isolate this specific stream pipeline
  const streamId = `${action}_stream_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

  // Register the real-time event listener
  streamListeners.set(streamId, onData);

  if ((window as any).AndroidBridge) {
    const jsonString = JSON.stringify(payload);
    // Tell Kotlin to start the gRPC stream and pass it the streamId channel
    (window as any).AndroidBridge.startNativeInternalStream(action, jsonString, streamId);
  } else {
    console.warn(`AndroidBridge not found. Mocking active stream for: ${action}`);
    // Simulated Desktop browser mock stream interval
    const interval = setInterval(() => onData({ mockStreamData: Math.random() } as any), 1000);
    return () => clearInterval(interval);
  }

  // Return a cleanup/unsubscription function
  return () => {
    streamListeners.delete(streamId);
    if ((window as any).AndroidBridge) {
      // Notify Kotlin to cancel the gRPC network collection and save memory/battery
      (window as any).AndroidBridge.stopNativeInternalStream(streamId);
    }
  };
}