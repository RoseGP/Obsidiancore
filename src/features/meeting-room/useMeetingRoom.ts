/**
 * React binding for MeetingRoomController: one controller per mounted meeting room, rendered through
 * useSyncExternalStore. Under React StrictMode the effect runs, cleans up and runs again in development; a
 * disposed controller is replaced with a fresh one, so capture and listeners never outlive the component.
 */
import { useEffect, useState, useSyncExternalStore } from 'react';
import { createMeetingRoomController, type MeetingRoomController } from './room/MeetingRoomController';

export function useMeetingRoom(factory: () => MeetingRoomController = () => createMeetingRoomController()) {
  const [controller, setController] = useState(factory);
  useEffect(() => {
    if (controller.isDisposed) { setController(factory()); return; }
    void controller.init();
    return () => controller.dispose();
  }, [controller]); // eslint-disable-line react-hooks/exhaustive-deps
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  return { controller, snapshot };
}
