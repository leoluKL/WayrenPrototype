import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)


/* sample usage
import React, { useEffect, useState } from 'react';
import { callNativeApi, subscribeToNativeStream } from './nativeBridge'; // Import both bridge handlers

// Define interfaces for strong typing
interface UserProfile {
  name: string;
  id: string;
}

interface PriceTick {
  price: number;
  token: string;
}

export function UserProfileDashboard() {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [ticker, setTicker] = useState<PriceTick | null>(null);

  // Hook 1: Handles the one-time gRPC request (Runs once on mount)
  useEffect(() => {
    async function loadData() {
      try {
        // Calls TypeScript -> WebAppInterface.sendToNative -> gRPC -> returns JSON
        const data = await callNativeApi<UserProfile>('getUserProfile', { userId: '123' });
        setUser(data);
      } catch (error) {
        console.error("Failed to load user profile over the bridge", error);
      }
    }
    loadData();
  }, []);

  // Hook 2: Handles the real-time continuous gRPC stream
  useEffect(() => {
    // Starts the stream -> WebAppInterface.startNativeStream -> listens to gRPC stream events
    const unsubscribe = subscribeToNativeStream<PriceTick>(
      'subscribePriceStream',
      { market: 'USDT' }, // Initialization parameters passed down to Kotlin
      (newStreamData) => {
        // This callback triggers every single time Kotlin fires window.handleAndroidStreamEvent
        setTicker(newStreamData);
      }
    );

    // CRITICAL CLEANUP: When this component unmounts, this fires WebAppInterface.stopNativeStream
    return () => {
      unsubscribe();
    };
  }, []);

  // Show a loading screen until at least the user profile data returns
  if (!user) return <div style={styles.loading}>Loading profile from gRPC backend...</div>;

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <h3>Welcome back, {user.name}!</h3>
        <p>User ID: {user.id}</p>
      </div>
      <div style={styles.streamCard}>
        <h4>⚡ Real-Time gRPC Price Feed</h4>
        {ticker ? (
          <div>
            <p>Asset Pair: <strong>{ticker.token}/USDT</strong></p>
            <p style={styles.price}>
              Live Price: ${ticker.price.toFixed(2)}
            </p>
          </div>
        ) : (
          <p style={styles.waiting}>Connecting to native stream channel...</p>
        )}
      </div>
    </div>
  );
}

// Inline styling for presentation structure
const styles = {
  container: {
    padding: '20px',
    fontFamily: 'sans-serif',
  },
  loading: {
    padding: '20px',
    textAlign: 'center' as const,
  },
  card: {
    padding: '20px',
    border: '1px solid #ccc',
    borderRadius: '8px',
    marginBottom: '20px',
    backgroundColor: '#fff',
  },
  streamCard: {
    padding: '20px',
    border: '1px solid #333',
    borderRadius: '8px',
    backgroundColor: '#1a1a1a',
    color: '#fff',
  },
  price: {
    fontSize: '24px',
    fontWeight: 'bold' as const,
    color: '#4caf50',
    margin: '10px 0 0 0',
  },
  waiting: {
    color: '#888',
    fontStyle: 'italic',
  }
};
*/