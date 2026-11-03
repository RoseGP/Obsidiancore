/** Shared in-meeting state (hands, reactions, polls, whiteboard) synced over the real-time channel. */
import { useCallback, useEffect, useRef, useState } from 'react';
import { createMeetingChannel, type ConnectionState, type Envelope, type MeetingChannel, type MeetingPoll, type WhiteboardStroke } from '../../../lib/meetingRealtime';

export interface RemoteReaction { id: string; emoji: string; name: string }

export function useMeetingCollab(roomId: string | null, selfName: string) {
  const chan = useRef<MeetingChannel | null>(null);
  const [state, setState] = useState<ConnectionState>('connecting');
  const [hands, setHands] = useState<Record<string, string>>({}); // senderId -> name
  const [reactions, setReactions] = useState<RemoteReaction[]>([]);
  const [polls, setPolls] = useState<MeetingPoll[]>([]);
  const [votes, setVotes] = useState<Record<string, Record<string, number>>>({}); // pollId -> voterId -> option
  const [strokes, setStrokes] = useState<WhiteboardStroke[]>([]);
  const [unseen, setUnseen] = useState({ polls: 0, whiteboard: 0 });
  const [selfId, setSelfId] = useState('local');

  useEffect(() => {
    if (!roomId) return;
    const c = createMeetingChannel(roomId);
    chan.current = c;
    setSelfId(c.selfId);
    const offState = c.onState(setState);
    const off = c.subscribe((e: Envelope) => {
      switch (e.type) {
        case 'hand':
          setHands((h) => { const n = { ...h }; if (e.raised) n[e.senderId] = e.name; else delete n[e.senderId]; return n; });
          break;
        case 'reaction': {
          const r = { id: e.id, emoji: e.emoji, name: e.name };
          setReactions((s) => [...s, r].slice(-20));
          setTimeout(() => setReactions((s) => s.filter((x) => x.id !== r.id)), 3500);
          break;
        }
        case 'poll:create':
          setPolls((p) => (p.some((x) => x.id === e.poll.id) ? p : [...p, e.poll]));
          setUnseen((u) => ({ ...u, polls: u.polls + 1 }));
          break;
        case 'poll:vote':
          setVotes((v) => ({ ...v, [e.pollId]: { ...(v[e.pollId] ?? {}), [e.voterId]: e.optionIndex } }));
          break;
        case 'poll:close':
          setPolls((p) => p.map((x) => (x.id === e.pollId ? { ...x, closed: true } : x)));
          break;
        case 'whiteboard:stroke':
          setStrokes((s) => [...s, e.stroke].slice(-4000));
          setUnseen((u) => ({ ...u, whiteboard: u.whiteboard + 1 }));
          break;
        case 'whiteboard:clear':
          setStrokes([]);
          break;
      }
    });
    return () => { off(); offState(); c.close(); chan.current = null; };
  }, [roomId]);

  return {
    connection: state,
    selfId,
    remoteHands: Object.values(hands),
    remoteReactions: reactions,
    polls, votes, strokes, unseen,
    markSeen: useCallback((k: 'polls' | 'whiteboard') => setUnseen((u) => ({ ...u, [k]: 0 })), []),
    setHand: useCallback((raised: boolean) => chan.current?.send({ type: 'hand', raised, name: selfName }), [selfName]),
    sendReaction: useCallback((emoji: string) => chan.current?.send({ type: 'reaction', emoji, name: selfName }), [selfName]),
    createPoll: useCallback((question: string, options: string[]) => {
      const poll: MeetingPoll = { id: `poll-${Date.now()}`, question, options, createdBy: selfName, createdAt: Date.now() };
      setPolls((p) => [...p, poll]);
      chan.current?.send({ type: 'poll:create', poll });
    }, [selfName]),
    vote: useCallback((pollId: string, optionIndex: number) => {
      const voterId = chan.current?.selfId ?? 'local';
      setVotes((v) => ({ ...v, [pollId]: { ...(v[pollId] ?? {}), [voterId]: optionIndex } }));
      chan.current?.send({ type: 'poll:vote', pollId, optionIndex, voterId });
    }, []),
    closePoll: useCallback((pollId: string) => {
      setPolls((p) => p.map((x) => (x.id === pollId ? { ...x, closed: true } : x)));
      chan.current?.send({ type: 'poll:close', pollId });
    }, []),
    addStroke: useCallback((stroke: WhiteboardStroke) => {
      setStrokes((s) => [...s, stroke]);
      chan.current?.send({ type: 'whiteboard:stroke', stroke });
    }, []),
    clearBoard: useCallback(() => { setStrokes([]); chan.current?.send({ type: 'whiteboard:clear' }); }, []),
  };
}

export type MeetingCollab = ReturnType<typeof useMeetingCollab>;
