import UnlockVault from './components/UnlockVault';
import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router';
import { AuthProvider, useAuth } from './context/AuthContext';
import { Capacitor } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';
import { OTAUpdateManager } from './components/OTAUpdateManager';
import Layout from './components/Layout';
import Login from './pages/Login';
import Register from './pages/Register';
import Home from './pages/Home';
import Dashboard from './pages/Dashboard';
import Job from './pages/Job';
import Settings from './pages/Settings';
import AdminPortal from './pages/AdminPortal';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';
import Pricing from './pages/Pricing';
import ApiDocs from './pages/ApiDocs';
import Legal from './pages/Legal';
import TaxCenter from './pages/TaxCenter';
import Invoices from './pages/Invoices';

const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  const { user, loading, isVaultLocked } = useAuth();
  if (loading) return <div className="min-h-screen flex items-center justify-center text-white">Loading...</div>;
  if (!user) return <Navigate to="/login" />;
  if (isVaultLocked) return <UnlockVault />;
  return <>{children}</>;
};
const GuestRoute = ({ children }: { children: React.ReactNode }) => {
  const { user, loading } = useAuth();
  if (loading) return <div className="min-h-screen flex items-center justify-center text-white">Loading...</div>;
  if (user) return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
};

const PushManager = () => {
  const { token } = useAuth();

  React.useEffect(() => {
    if (Capacitor.isNativePlatform() && token) {
      PushNotifications.requestPermissions().then(result => {
        if (result.receive === 'granted') {
          PushNotifications.register();
        }
      });

      const regListener = PushNotifications.addListener('registration', async (t) => {
        console.log('Push registration success');
        try {
          await fetch('/api/settings/device-token', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ token: t.value })
          });
        } catch (e) {
          console.error('Failed to save device token', e);
        }
      });

      const errListener = PushNotifications.addListener('registrationError', (error: any) => {
        console.error('Error on registration: ' + JSON.stringify(error));
      });

      const recListener = PushNotifications.addListener('pushNotificationReceived', (notification) => {
        console.log('Push notification received');
      });

      return () => {
        regListener.then(l => l.remove());
        errListener.then(l => l.remove());
        recListener.then(l => l.remove());
      };
    }
  }, [token]);

  return null;
};

export default function App() {
  return (
    <AuthProvider>
      <OTAUpdateManager />
      <PushManager />
      <Router>
        <Routes>
          <Route path="/" element={<GuestRoute><Home /></GuestRoute>} />
          <Route path="/login" element={<GuestRoute><Login /></GuestRoute>} />
          <Route path="/register" element={<GuestRoute><Register /></GuestRoute>} />
          <Route path="/forgot-password" element={<GuestRoute><ForgotPassword /></GuestRoute>} />
          <Route path="/reset-password" element={<GuestRoute><ResetPassword /></GuestRoute>} />
          <Route path="/legal" element={<Legal />} />
          
          {/* Protected App Routes */}
          <Route element={<ProtectedRoute><Layout /></ProtectedRoute>}>
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/reports" element={<Navigate to="/dashboard?view=reports" replace />} />
            <Route path="/taxes" element={<TaxCenter />} />
            <Route path="/invoices" element={<Invoices />} />
            <Route path="/jobs/:id" element={<Job />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/admin" element={<AdminPortal />} />
            <Route path="/pricing" element={<Pricing />} />
            <Route path="/api-docs" element={<ApiDocs />} />
          </Route>

          {/* Fallback */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Router>
    </AuthProvider>
  );
}
