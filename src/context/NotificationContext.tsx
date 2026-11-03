import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { AppNotification, ActiveView } from '../types';

export interface ToastItem extends AppNotification {
  duration?: number;
  createdAt: number;
}

export interface ChannelDeliveryPreferences {
  inApp: boolean;
  push: boolean;
  sound: boolean;
}

export interface EventTypePreferences {
  newLeadAlerts: { inApp: boolean; push: boolean };
  taskReminders: { inApp: boolean; push: boolean };
  systemUpdates: { inApp: boolean; push: boolean };
  clientMessages: { inApp: boolean; push: boolean };
  slaEscalations: { inApp: boolean; push: boolean };
}

export interface NotificationPreferences {
  channels: ChannelDeliveryPreferences;
  events: EventTypePreferences;
  priorityThreshold: 'all' | 'high_and_urgent' | 'urgent_only';
  quietHours: {
    enabled: boolean;
    start: string; // e.g. "22:00"
    end: string;   // e.g. "07:00"
  };
  deliveryFrequency: 'instant' | 'hourly_digest' | 'daily_summary';
}

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  channels: {
    inApp: true,
    push: false,
    sound: true,
  },
  events: {
    newLeadAlerts: { inApp: true, push: true },
    taskReminders: { inApp: true, push: true },
    systemUpdates: { inApp: true, push: false },
    clientMessages: { inApp: true, push: true },
    slaEscalations: { inApp: true, push: true },
  },
  priorityThreshold: 'all',
  quietHours: {
    enabled: false,
    start: '22:00',
    end: '07:00',
  },
  deliveryFrequency: 'instant',
};

interface NotificationContextType {
  notifications: AppNotification[];
  unreadCount: number;
  activeToasts: ToastItem[];
  soundEnabled: boolean;
  setSoundEnabled: (enabled: boolean) => void;
  preferences: NotificationPreferences;
  updatePreferences: (updates: Partial<NotificationPreferences>) => void;
  updateEventPreference: (
    event: keyof EventTypePreferences,
    channel: 'inApp' | 'push',
    value: boolean
  ) => void;
  resetPreferences: () => void;
  pushPermission: 'granted' | 'denied' | 'default' | 'unsupported';
  requestPushPermission: () => Promise<boolean>;
  sendTestNotification: (
    channel: 'inApp' | 'push',
    type: 'lead' | 'task' | 'system'
  ) => void;
  pushNotification: (data: {
    title: string;
    message: string;
    type: AppNotification['type'];
    priority?: AppNotification['priority'];
    channel?: AppNotification['channel'];
    avatar?: string;
    targetView?: ActiveView;
    targetId?: string;
    metadata?: Record<string, any>;
    showToast?: boolean;
    duration?: number;
    forceDelivery?: boolean;
  }) => void;
  dismissToast: (id: string) => void;
  markAsRead: (id: string) => void;
  markAllAsRead: () => void;
  deleteNotification: (id: string) => void;
  clearAllNotifications: () => void;
}

const NotificationContext = createContext<NotificationContextType | undefined>(undefined);

// Web Audio API Synthesizer for subtle, non-intrusive luxury audio chime
function playLuxuryChime(priority: AppNotification['priority'] = 'normal') {
  try {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) return;
    const ctx = new AudioContextClass();
    
    // Create dual-tone soft chime
    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const gainNode = ctx.createGain();

    const now = ctx.currentTime;
    
    if (priority === 'urgent') {
      osc1.frequency.setValueAtTime(587.33, now); // D5
      osc1.frequency.exponentialRampToValueAtTime(880, now + 0.12); // A5
      osc2.frequency.setValueAtTime(880, now);
      osc2.frequency.exponentialRampToValueAtTime(1174.66, now + 0.12); // D6
    } else {
      osc1.frequency.setValueAtTime(523.25, now); // C5
      osc1.frequency.exponentialRampToValueAtTime(659.25, now + 0.08); // E5
      osc2.frequency.setValueAtTime(783.99, now); // G5
      osc2.frequency.exponentialRampToValueAtTime(1046.50, now + 0.12); // C6
    }

    osc1.type = 'sine';
    osc2.type = 'sine';

    gainNode.gain.setValueAtTime(0.001, now);
    gainNode.gain.linearRampToValueAtTime(priority === 'urgent' ? 0.08 : 0.04, now + 0.02);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, now + 0.45);

    osc1.connect(gainNode);
    osc2.connect(gainNode);
    gainNode.connect(ctx.destination);

    osc1.start(now);
    osc2.start(now);
    osc1.stop(now + 0.45);
    osc2.stop(now + 0.45);
  } catch {
    // Graceful fallback if audio context blocked by browser autoplay policy
  }
}

// TO COMPLETE: load notifications from your notifications store (e.g. Firestore users/{uid}/notifications).
const DEFAULT_NOTIFICATIONS: AppNotification[] = [];

export const NotificationProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [notifications, setNotifications] = useState<AppNotification[]>(() => {
    try {
      const saved = localStorage.getItem('obsidian_crm_notifications_v2');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {
      // Fallback
    }
    return DEFAULT_NOTIFICATIONS;
  });

  const [preferences, setPreferences] = useState<NotificationPreferences>(() => {
    try {
      const saved = localStorage.getItem('obsidian_notification_preferences_v2');
      if (saved) {
        const { emailRecipient: _drop, ...rest } = JSON.parse(saved);
        return { ...DEFAULT_NOTIFICATION_PREFERENCES, ...rest, channels: { ...DEFAULT_NOTIFICATION_PREFERENCES.channels, ...(rest.channels ?? {}) } };
      }
    } catch {
      // fallback
    }
    return DEFAULT_NOTIFICATION_PREFERENCES;
  });

  const [pushPermission, setPushPermission] = useState<'granted' | 'denied' | 'default' | 'unsupported'>('default');

  useEffect(() => {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      setPushPermission(Notification.permission as any);
    } else {
      setPushPermission('unsupported');
    }
  }, []);

  const [activeToasts, setActiveToasts] = useState<ToastItem[]>([]);
  const [soundEnabled, setSoundEnabled] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('obsidian_notification_sound');
      return saved !== null ? JSON.parse(saved) : true;
    } catch {
      return true;
    }
  });

  // Persist notifications and preferences
  useEffect(() => {
    try {
      localStorage.setItem('obsidian_crm_notifications_v2', JSON.stringify(notifications));
    } catch {}
  }, [notifications]);

  useEffect(() => {
    try {
      localStorage.setItem('obsidian_notification_preferences_v2', JSON.stringify(preferences));
    } catch {}
  }, [preferences]);

  useEffect(() => {
    try {
      localStorage.setItem('obsidian_notification_sound', JSON.stringify(soundEnabled));
    } catch {}
  }, [soundEnabled]);

  const unreadCount = notifications.filter(n => !n.read).length;

  const updatePreferences = useCallback((updates: Partial<NotificationPreferences>) => {
    setPreferences(prev => ({
      ...prev,
      ...updates,
      channels: { ...prev.channels, ...(updates.channels || {}) },
      events: { ...prev.events, ...(updates.events || {}) },
      quietHours: { ...prev.quietHours, ...(updates.quietHours || {}) },
    }));
  }, []);

  const updateEventPreference = useCallback((
    event: keyof EventTypePreferences,
    channel: 'inApp' | 'push',
    value: boolean
  ) => {
    setPreferences(prev => ({
      ...prev,
      events: {
        ...prev.events,
        [event]: {
          ...prev.events[event],
          [channel]: value,
        },
      },
    }));
  }, []);

  const resetPreferences = useCallback(() => {
    setPreferences(DEFAULT_NOTIFICATION_PREFERENCES);
  }, []);

  const requestPushPermission = useCallback(async (): Promise<boolean> => {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      setPushPermission('unsupported');
      return false;
    }
    try {
      const permission = await Notification.requestPermission();
      setPushPermission(permission as any);
      const isGranted = permission === 'granted';
      if (isGranted) {
        setPreferences(prev => ({
          ...prev,
          channels: { ...prev.channels, push: true },
        }));
      }
      return isGranted;
    } catch (e) {
      console.warn('Failed to request push permission', e);
      return false;
    }
  }, []);


  // Check if current time is inside Quiet Hours
  const isCurrentlyInQuietHours = useCallback(() => {
    if (!preferences.quietHours.enabled) return false;
    try {
      const now = new Date();
      const currentMinutes = now.getHours() * 60 + now.getMinutes();
      const [startH, startM] = preferences.quietHours.start.split(':').map(Number);
      const [endH, endM] = preferences.quietHours.end.split(':').map(Number);
      const startMinutes = startH * 60 + startM;
      const endMinutes = endH * 60 + endM;

      if (startMinutes < endMinutes) {
        return currentMinutes >= startMinutes && currentMinutes <= endMinutes;
      } else {
        // Overnight quiet hours (e.g. 22:00 to 07:00)
        return currentMinutes >= startMinutes || currentMinutes <= endMinutes;
      }
    } catch {
      return false;
    }
  }, [preferences.quietHours]);

  const pushNotification = useCallback(({
    title,
    message,
    type,
    priority = 'normal',
    channel = 'web',
    avatar,
    targetView,
    targetId,
    metadata,
    showToast = true,
    duration = 5500,
    forceDelivery = false
  }: {
    title: string;
    message: string;
    type: AppNotification['type'];
    priority?: AppNotification['priority'];
    channel?: AppNotification['channel'];
    avatar?: string;
    targetView?: ActiveView;
    targetId?: string;
    metadata?: Record<string, any>;
    showToast?: boolean;
    duration?: number;
    forceDelivery?: boolean;
  }) => {
    // Check priority thresholds
    if (!forceDelivery) {
      if (preferences.priorityThreshold === 'urgent_only' && priority !== 'urgent') {
        return;
      }
      if (preferences.priorityThreshold === 'high_and_urgent' && priority !== 'urgent' && priority !== 'high') {
        return;
      }
    }

    const inQuietHours = isCurrentlyInQuietHours();
    const isUrgent = priority === 'urgent';

    // Map notification type to event preference category
    let eventKey: keyof EventTypePreferences = 'systemUpdates';
    if (type === 'lead') eventKey = 'newLeadAlerts';
    else if (type === 'task') eventKey = 'taskReminders';
    else if (type === 'message') eventKey = 'clientMessages';
    else if (type === 'system') eventKey = 'systemUpdates';
    else if (metadata?.isSla || title.includes('SLA')) eventKey = 'slaEscalations';

    const eventRule = preferences.events[eventKey] || { inApp: true, push: false };

    // 1. In-App Notification (Always add to history list unless totally suppressed)
    const id = `notif-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    const newNotif: AppNotification = {
      id,
      title,
      message,
      timestamp,
      read: false,
      type,
      priority,
      channel,
      avatar,
      targetView,
      targetId,
      metadata
    };

    setNotifications(prev => [newNotif, ...prev.slice(0, 49)]); // Cap at 50

    // 2. In-App Toast & Audio (if inApp channel & eventRule.inApp & not muted by quiet hours unless urgent)
    const allowToast = preferences.channels.inApp && eventRule.inApp && (!inQuietHours || isUrgent);
    if (showToast && allowToast) {
      const toastItem: ToastItem = {
        ...newNotif,
        duration,
        createdAt: Date.now()
      };

      setActiveToasts(prev => [toastItem, ...prev.slice(0, 4)]);
      if (soundEnabled && preferences.channels.sound && (!inQuietHours || isUrgent)) {
        playLuxuryChime(priority);
      }
    }

    // 3. Web Push Notification (if push enabled in channels, event preferences, and granted by browser)
    const allowPush = preferences.channels.push && eventRule.push && (!inQuietHours || isUrgent);
    if (allowPush && typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
      try {
        new Notification(title, {
          body: message,
          icon: avatar || '/favicon.ico',
          tag: id,
        });
      } catch (err) {
        console.warn('Native notification failed:', err);
      }
    }

  }, [preferences, isCurrentlyInQuietHours, soundEnabled]);

  const dismissToast = useCallback((id: string) => {
    setActiveToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const markAsRead = useCallback((id: string) => {
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
  }, []);

  const markAllAsRead = useCallback(() => {
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
  }, []);

  const deleteNotification = useCallback((id: string) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
    dismissToast(id);
  }, [dismissToast]);

  const clearAllNotifications = useCallback(() => {
    setNotifications([]);
    setActiveToasts([]);
  }, []);

  // Pre-configured realistic incoming simulation events
  const sendTestNotification = useCallback((
    channel: 'inApp' | 'push',
    type: 'lead' | 'task' | 'system'
  ) => {
    const titles = {
      lead: '🎯 [TEST ALERT] Inbound Enterprise Lead',
      task: '⏰ [TEST ALERT] Critical Task Milestone Reminder',
      system: '⚙️ [TEST ALERT] System Integrity Verification',
    };
    const messages = {
      lead: 'Test inbound lead alert dispatched through configured preferences.',
      task: 'Test task reminder triggered to verify notification delivery.',
      system: 'Test system update alert confirming pipeline connectivity.',
    };

    pushNotification({
      title: titles[type],
      message: `${messages[type]} Delivery channel: [${channel.toUpperCase()}].`,
      type: type,
      priority: 'high',
      channel: 'web',
      showToast: channel === 'inApp',
      forceDelivery: true,
    });
  }, [pushNotification]);

  return (
    <NotificationContext.Provider
      value={{
        notifications,
        unreadCount,
        activeToasts,
        soundEnabled,
        setSoundEnabled,
        preferences,
        updatePreferences,
        updateEventPreference,
        resetPreferences,
        pushPermission,
        requestPushPermission,
        sendTestNotification,
        pushNotification,
        dismissToast,
        markAsRead,
        markAllAsRead,
        deleteNotification,
        clearAllNotifications,
      }}
    >
      {children}
    </NotificationContext.Provider>
  );
};

export const useNotifications = () => {
  const context = useContext(NotificationContext);
  if (!context) {
    throw new Error('useNotifications must be used within a NotificationProvider');
  }
  return context;
};
